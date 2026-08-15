import QRCode from "qrcode";
import { createServer, request } from "node:http";
import { networkInterfaces } from "node:os";
import { deflateSync } from "node:zlib";
//#region src/lan-proxy.ts
/**
* LAN reverse proxy for the Harness web GUI.
*
* The core webserver binds loopback only (upstream deliberately rejects
* `--host 0.0.0.0`). This proxy is an explicit, plugin-owned opt-in: it
* listens on all interfaces and forwards every request — HTTP and WebSocket
* upgrades — to the loopback server, rewriting the Host and (same-origin)
* Origin headers back to loopback so the /api browser-trust fence
* (isTrustedApiRequest) accepts the proxied traffic exactly as if it had
* arrived locally.
*
* SECURITY: whoever can reach the advertised LAN URL can drive the whole
* Harness, including its code-execution tools. That is the point of the
* plugin and the reason it must stay disabled on untrusted networks.
* @module dsh-mobile/lan-proxy
*/
/** All non-internal IPv4 addresses of this machine, in os order. */
function lanAddresses() {
	return Object.values(networkInterfaces()).flat().filter((i) => i !== void 0 && i.family === "IPv4" && !i.internal).map((i) => i.address);
}
/** One live reverse proxy; create via {@link LanProxy.start}. */
var LanProxy = class LanProxy {
	loopbackPort;
	server;
	/** @param loopbackPort - the core server's port (ctx.webServer.port). */
	constructor(loopbackPort, server) {
		this.loopbackPort = loopbackPort;
		this.server = server;
	}
	/**
	* Bind the proxy on all interfaces and start forwarding.
	* @param loopbackPort - core webserver port.
	* @param listenPort - first port to try on 0.0.0.0.
	* @param allowed - optional exact client IP allowlist ('' = allow all).
	* @returns the started proxy, or throws when every port attempt failed.
	*/
	static async start(loopbackPort, listenPort, allowed = []) {
		let lastError;
		for (let port = listenPort; port < listenPort + 10; port++) try {
			return await LanProxy.bind(loopbackPort, port, allowed);
		} catch (error) {
			lastError = error;
			if (!(error instanceof Error && "code" in error && error.code === "EADDRINUSE")) throw error;
		}
		throw lastError instanceof Error ? lastError : new Error(String(lastError));
	}
	static bind(loopbackPort, port, allowed) {
		return new Promise((resolve, reject) => {
			const blocked = (ip) => allowed.length > 0 && !allowed.includes(ip);
			const server = createServer((req, res) => {
				if (blocked(clientIp(req))) {
					res.writeHead(403);
					res.end("forbidden");
					return;
				}
				forwardRequest(req, res, loopbackPort).catch(() => {
					if (!res.headersSent) res.writeHead(502);
					res.end("proxy error");
				});
			});
			server.on("upgrade", (req, socket, head) => {
				if (blocked(clientIp(req))) {
					socket.destroy();
					return;
				}
				forwardUpgrade(req, socket, head, loopbackPort);
			});
			server.once("error", reject);
			server.listen(port, "0.0.0.0", () => {
				server.off("error", reject);
				server.on("error", (err) => {});
				resolve(new LanProxy(loopbackPort, server));
			});
		});
	}
	/** The bound port (0.0.0.0). */
	get port() {
		const addr = this.server.address();
		return typeof addr === "object" && addr !== null ? addr.port : 0;
	}
	/** Close the listener, drop remaining connections, and wait for teardown. */
	async dispose() {
		const server = this.server;
		server.closeAllConnections?.();
		await new Promise((resolve) => server.close(() => resolve()));
	}
};
/** The socket's remote address for allowlist checks. */
function clientIp(req) {
	const addr = req.socket.remoteAddress ?? "";
	return addr.startsWith("::ffff:") ? addr.slice(7) : addr;
}
/** Headers for the upstream request: loopback Host, loopback Origin for same-origin browsers. */
function forwardedHeaders(headers, proxyAuthority, loopbackPort) {
	const out = {};
	for (const [key, value] of Object.entries(headers)) {
		if (value === void 0) continue;
		const lower = key.toLowerCase();
		if (lower === "host" || lower === "origin" || lower === "connection" || lower === "upgrade") continue;
		out[key] = value;
	}
	out.host = `127.0.0.1:${loopbackPort}`;
	const origin = headers.origin;
	if (typeof origin === "string") try {
		if (new URL(origin).host === proxyAuthority) out.origin = `http://127.0.0.1:${loopbackPort}`;
	} catch {}
	return out;
}
/** Proxy one plain HTTP request to the loopback server. */
async function forwardRequest(req, res, loopbackPort) {
	const proxyAuthority = req.headers.host ?? "";
	const upstream = request({
		host: "127.0.0.1",
		port: loopbackPort,
		path: req.url,
		method: req.method,
		headers: forwardedHeaders(req.headers, proxyAuthority, loopbackPort)
	}, (upRes) => {
		res.writeHead(upRes.statusCode ?? 502, upRes.headers);
		upRes.pipe(res);
	});
	upstream.on("error", (error) => {
		if (!res.headersSent) res.writeHead(502);
		res.end("proxy error");
	});
	res.on("close", () => upstream.destroy());
	req.pipe(upstream);
}
/** Proxy a WebSocket upgrade to the loopback server, keeping one raw duplex. */
function forwardUpgrade(req, socket, head, loopbackPort) {
	const proxyAuthority = req.headers.host ?? "";
	const upstream = request({
		host: "127.0.0.1",
		port: loopbackPort,
		path: req.url,
		method: "GET",
		headers: {
			...forwardedHeaders(req.headers, proxyAuthority, loopbackPort),
			connection: "Upgrade",
			upgrade: "websocket"
		},
		agent: false
	});
	upstream.on("upgrade", (upRes, upSocket, upHead) => {
		socket.write("HTTP/1.1 101 Switching Protocols\r\n");
		for (const [key, value] of Object.entries(upRes.headers)) {
			if (value === void 0) continue;
			socket.write(`${key}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`);
		}
		socket.write("\r\n");
		if (upHead.length > 0) socket.write(upHead);
		upSocket.pipe(socket);
		socket.pipe(upSocket);
		const close = () => {
			upSocket.destroy();
			socket.destroy();
		};
		upSocket.on("error", close);
		socket.on("error", close);
	});
	upstream.on("response", (upRes) => {
		socket.end([
			`HTTP/1.1 ${upRes.statusCode ?? 502}`,
			...Object.entries(upRes.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`),
			"",
			""
		].join("\r\n"));
		upRes.destroy();
	});
	upstream.on("error", () => socket.destroy());
	if (head.length > 0) upstream.write(head);
	upstream.end();
}
//#endregion
//#region src/icons.ts
/**
* Procedural app icons: a tiny PNG encoder (zlib + CRC32) plus a
* dependency-free vector renderer (signed-distance-field shapes with smooth
* alpha edges, drawn in normalized 0..1 space so any size renders crisply).
* The design is a chat bubble with three dots on the dsh brand blue — small
* enough to read at 180px (iOS home screen) and 512px (manifest).
* @module dsh-mobile/icons
*/
const CRC_TABLE = (() => {
	const table = /* @__PURE__ */ new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();
function crc32(buf) {
	let c = 4294967295;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 255] ^ c >>> 8;
	return (c ^ 4294967295) >>> 0;
}
function pngChunk(type, data) {
	const out = Buffer.alloc(8 + data.length + 4);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, "ascii");
	data.copy(out, 8);
	out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
	return out;
}
/** Encode an RGBA pixel buffer (width*height*4) as a PNG. */
function encodePng(width, height, rgba) {
	const signature = Buffer.from([
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10
	]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0;
		rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}
	return Buffer.concat([
		signature,
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(raw, { level: 9 })),
		pngChunk("IEND", Buffer.alloc(0))
	]);
}
/** Signed distance to a rounded rectangle centered at origin, half-extents (hx,hy), corner radius r. */
function sdRoundRect(px, py, hx, hy, r) {
	const qx = Math.abs(px) - (hx - r);
	const qy = Math.abs(py) - (hy - r);
	return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
/** Signed distance to a circle. */
function sdCircle(px, py, cx, cy, r) {
	return Math.hypot(px - cx, py - cy) - r;
}
/** Signed distance to a diamond (|dx|+|dy| < s). */
function sdDiamond(px, py, cx, cy, s) {
	return Math.abs(px - cx) + Math.abs(py - cy) - s;
}
/** Smooth 0..1 coverage from an SDF, with a ~1px antialiased edge. */
function coverage(sdf, px) {
	return Math.min(1, Math.max(0, .5 - sdf / px));
}
/** Linear interpolation between two hex colors. */
function mix(a, b, t) {
	const pa = [
		1,
		3,
		5
	].map((i) => parseInt(a.slice(i, i + 2), 16));
	const pb = [
		1,
		3,
		5
	].map((i) => parseInt(b.slice(i, i + 2), 16));
	return [
		0,
		1,
		2
	].map((i) => Math.round(pa[i] + (pb[i] - pa[i]) * t));
}
/**
* Render the app icon at one size.
* @param size - square side in pixels.
* @returns a PNG buffer.
*/
function renderIcon(size) {
	const px = Buffer.alloc(size * size * 4);
	const bgTop = mix("#4f7cf7", "#2c4bb5", 0);
	const bgBottom = mix("#4f7cf7", "#2c4bb5", 1);
	const blue = [
		47,
		75,
		181
	];
	const white = [
		255,
		255,
		255
	];
	const edge = 1 / size;
	const radius = .22;
	const bubble = {
		cx: .5,
		cy: .46,
		r: .3
	};
	const dotR = .038;
	const over = (r, g, b, a, cr, cg, cb, cov) => {
		const outA = a + cov * (1 - a);
		const t = outA < 1e-9 ? 0 : cov / outA;
		return [
			r + (cr - r) * t,
			g + (cg - g) * t,
			b + (cb - b) * t,
			outA
		];
	};
	for (let y = 0; y < size; y++) {
		const ny = (y + .5) / size;
		for (let x = 0; x < size; x++) {
			const nx = (x + .5) / size;
			const px2 = nx - .5;
			const py2 = ny - .5;
			let r = 0, g = 0, b = 0, a = 0;
			const bgCov = coverage(sdRoundRect(px2, py2, .5, .5, radius), edge);
			if (bgCov > 0) {
				const t = Math.min(1, Math.max(0, ny));
				const br = Math.round(bgTop[0] + (bgBottom[0] - bgTop[0]) * t);
				const bg = Math.round(bgTop[1] + (bgBottom[1] - bgTop[1]) * t);
				const bb = Math.round(bgTop[2] + (bgBottom[2] - bgTop[2]) * t);
				[r, g, b, a] = over(r, g, b, a, br, bg, bb, bgCov);
			}
			const bubbleCov = coverage(Math.min(sdCircle(nx, ny, bubble.cx, bubble.cy, bubble.r), sdDiamond(nx, ny, .31, .74, .1)), edge);
			if (bubbleCov > 0) [r, g, b, a] = over(r, g, b, a, white[0], white[1], white[2], bubbleCov);
			for (const dx of [
				-.115,
				0,
				.115
			]) {
				const dotCov = coverage(sdCircle(nx, ny, bubble.cx + dx, bubble.cy, dotR), edge);
				if (dotCov > 0) [r, g, b, a] = over(r, g, b, a, blue[0], blue[1], blue[2], dotCov);
			}
			const idx = (y * size + x) * 4;
			px[idx] = Math.round(r);
			px[idx + 1] = Math.round(g);
			px[idx + 2] = Math.round(b);
			px[idx + 3] = Math.round(a * 255);
		}
	}
	return encodePng(size, size, px);
}
/** Cached icon buffers (generated once per size at first use). */
const cache = /* @__PURE__ */ new Map();
/** Get (and cache) the icon PNG at one size. */
function iconPng(size) {
	let buf = cache.get(size);
	if (buf === void 0) {
		buf = renderIcon(size);
		cache.set(size, buf);
	}
	return buf;
}
//#endregion
//#region src/pwa.ts
/**
* PWA chrome for the Harness web GUI: index.html taps (iOS standalone meta,
* viewport-fit, apple-touch-icon link), procedural icon routes, an enhanced
* manifest.webmanifest override, and the /mobile QR page that turns a phone
* camera into the fastest path to the LAN URL.
*
* Everything registers on the core (loopback) webserver, so it is served on
* the loopback GUI and — through the LAN proxy — on the phone alike.
* @module dsh-mobile/pwa
*/
const APP_NAME = "DeepSeek Harness";
/** Replace or inject the viewport meta and append the iOS standalone chrome. */
function injectHead(html) {
	let out = html;
	const viewport = "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content";
	if (/<meta[^>]+name=["']viewport["']/i.test(out)) out = out.replace(/<meta[^>]+name=["']viewport["'][^>]*>/i, `<meta name="viewport" content="${viewport}" />`);
	else out = out.replace("</head>", `<meta name="viewport" content="${viewport}" />
</head>`);
	const tags = [
		"<meta name=\"apple-mobile-web-app-capable\" content=\"yes\" />",
		"<meta name=\"mobile-web-app-capable\" content=\"yes\" />",
		"<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\" />",
		`<meta name="apple-mobile-web-app-title" content="${APP_NAME}" />`,
		"<meta name=\"theme-color\" content=\"#0b1220\" />",
		"<link rel=\"apple-touch-icon\" href=\"/apple-touch-icon.png\" />",
		"<link rel=\"icon\" type=\"image/png\" sizes=\"192x192\" href=\"/icons/icon-192.png\" />"
	];
	for (const tag of tags) {
		const key = (tag.match(/<meta[^>]+name=["']([^"']+)["']/) ?? tag.match(/<link[^>]+rel=["']([^"']+)["']/))?.[1];
		if (key !== void 0 && new RegExp(`<(meta|link)[^>]+\\.${key}\\.`).test(out)) continue;
		if (out.includes(tag)) continue;
		out = out.replace("</head>", `${tag}
</head>`);
	}
	return out;
}
const MANIFEST = {
	id: "/",
	name: APP_NAME,
	short_name: "DSH",
	description: "DeepSeek Harness — AI agent harness, usable from iPhone and iPad.",
	start_url: "/",
	scope: "/",
	display: "standalone",
	background_color: "#0b1220",
	theme_color: "#4f7cf7",
	icons: [{
		src: "/icons/icon-192.png",
		sizes: "192x192",
		type: "image/png",
		purpose: "any"
	}, {
		src: "/icons/icon-512.png",
		sizes: "512x512",
		type: "image/png",
		purpose: "any"
	}]
};
function jsonResponse(res, body, type = "application/json; charset=utf-8") {
	res.writeHead(200, {
		"content-type": type,
		"cache-control": "no-cache"
	});
	res.end(typeof body === "string" ? body : JSON.stringify(body));
}
/** Build the /mobile landing page (QR + steps + warning). */
function mobilePage(opts, qrSvg) {
	const { lanUrl, lanAddresses, port } = opts;
	const alternatives = lanAddresses.filter((addr) => !lanUrl.includes(addr)).map((addr) => `http://${addr}:${port}`);
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>在手机 / iPad 上使用 DeepSeek Harness</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, 'PingFang SC', 'Segoe UI', sans-serif; background: #0b1220; color: #e5e9f2; display: flex; justify-content: center; padding: 32px 20px 64px; }
  .card { width: min(520px, 100%); }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .sub { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
  .url { font-size: 17px; font-weight: 600; color: #7c9dff; word-break: break-all; user-select: all; padding: 12px 14px; background: rgba(79,124,247,0.12); border: 1px solid rgba(79,124,247,0.35); border-radius: 12px; margin-bottom: 20px; }
  .qr { background: #fff; border-radius: 16px; padding: 18px; display: flex; justify-content: center; margin-bottom: 20px; }
  .qr svg { width: min(280px, 80vw); height: auto; }
  .steps { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px 18px; margin-bottom: 20px; }
  .steps ol { margin: 0; padding-left: 20px; }
  .steps li { margin: 8px 0; font-size: 14px; line-height: 1.6; }
  .warn { background: rgba(255,170,60,0.08); border: 1px solid rgba(255,170,60,0.35); color: #ffd9a3; border-radius: 12px; padding: 14px 16px; font-size: 13px; line-height: 1.7; margin-bottom: 20px; }
  .alts { font-size: 12px; color: #64748b; }
  .alts a { color: #64748b; }
</style>
</head>
<body>
  <div class="card">
    <h1>在 iPhone / iPad 上使用</h1>
    <div class="sub">DeepSeek Harness 局域网访问 · 同一 Wi-Fi 下用相机扫码即开</div>
    <div class="url">${lanUrl}</div>
    <div class="qr">${qrSvg}</div>
    <div class="steps">
      <ol>
        <li>用 iPhone / iPad 的<b>相机</b>扫描上面的二维码(或直接输入网址);</li>
        <li>打开后点 Safari 底部的<b>「分享」</b>按钮 → <b>「添加到主屏幕」</b>;</li>
        <li>之后就能像原生 App 一样从主屏幕图标打开。</li>
      </ol>
    </div>
    <div class="warn"><b>⚠ 安全提示:</b> 这个地址把 Harness 的完整能力(包括执行代码的工具)暴露给了<b>同一局域网内的所有设备</b>。请只在信任的网络(自家 Wi-Fi)使用,连接公共 Wi-Fi 时请关闭本插件(从 cordis.patch.yml 移除 mobile 行)。</div>
    ${alternatives.length > 0 ? `<div class="alts">其他地址: ${alternatives.map((a) => `<a href="${a}">${a}</a>`).join(" · ")}</div>` : ""}
  </div>
</body>
</html>`;
}
/**
* Install the PWA taps, icon/manifest routes, and the /mobile page.
* @param ctx - host context with the webserver.
* @param options - LAN URL facts and the QR renderer.
* @returns disposers (registered through the caller's effect).
*/
function installPwa(ctx, options) {
	const disposers = [];
	disposers.push(ctx.webServer.tapIndex(injectHead));
	const sendIcon = (size) => (res) => {
		const buf = iconPng(size);
		res.writeHead(200, {
			"content-type": "image/png",
			"content-length": String(buf.length),
			"cache-control": "public, max-age=86400"
		});
		res.end(buf);
	};
	disposers.push(ctx.webServer.register({
		kind: "exact",
		path: "/apple-touch-icon.png",
		handler: (_req, res) => sendIcon(180)(res)
	}));
	disposers.push(ctx.webServer.register({
		kind: "exact",
		path: "/icons/icon-192.png",
		handler: (_req, res) => sendIcon(192)(res)
	}));
	disposers.push(ctx.webServer.register({
		kind: "exact",
		path: "/icons/icon-512.png",
		handler: (_req, res) => sendIcon(512)(res)
	}));
	disposers.push(ctx.webServer.register({
		kind: "exact",
		path: "/manifest.webmanifest",
		handler: (_req, res) => jsonResponse(res, MANIFEST, "application/manifest+json; charset=utf-8")
	}));
	let pageCache;
	disposers.push(ctx.webServer.register({
		kind: "exact",
		path: "/mobile",
		handler: async (_req, res) => {
			if (pageCache === void 0) pageCache = mobilePage(options, await options.qrSvg(options.lanUrl));
			res.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-cache"
			});
			res.end(pageCache);
		}
	}));
	return () => {
		for (const dispose of disposers.reverse()) dispose();
	};
}
//#endregion
//#region src/index.ts
/** Stable plugin name for the loader. */
const name = "dsh-mobile";
/** Services this row needs before apply runs. */
const inject = ["webServer"];
/** Default LAN proxy port. */
const DEFAULT_LAN_PORT = 3090;
const WARNING = [
	"────────────────────────────────────────────────────────────",
	"⚠ dsh-mobile: 手机访问已开启,但注意——",
	"  该地址向局域网暴露了 Harness 的完整能力(包括执行代码的工具)。",
	"  只在你信任的网络(自家 Wi-Fi)使用;连接公共 Wi-Fi 时请移除",
	"  cordis.patch.yml 里的 mobile 行或重启前停用本插件。",
	"────────────────────────────────────────────────────────────"
].join("\n");
/**
* Start the mobile surface: LAN proxy + PWA chrome + URL line.
* @param ctx - host context (webServer injected).
* @param config - optional row config.
*/
async function apply(ctx, config) {
	const loopbackPort = ctx.webServer.port;
	const lanPort = config?.lanPort ?? 3090;
	const allow = config?.allow ?? [];
	const proxy = await LanProxy.start(loopbackPort, lanPort, allow);
	ctx.effect(() => () => proxy.dispose(), "dsh-mobile: lan proxy");
	const addresses = lanAddresses();
	if (addresses.length === 0) ctx.logger.warn("dsh-mobile: no non-internal IPv4 interface found — phone access will not work over Wi-Fi.");
	const primary = addresses[0];
	const lanUrl = primary === void 0 ? `http://127.0.0.1:${proxy.port}` : `http://${primary}:${proxy.port}`;
	const qrSvg = (text) => QRCode.toString(text, {
		type: "svg",
		margin: 1,
		errorCorrectionLevel: "M",
		color: {
			dark: "#0b1220",
			light: "#ffffff"
		}
	});
	ctx.effect(() => installPwa(ctx, {
		lanUrl,
		lanAddresses: addresses,
		port: proxy.port,
		qrSvg
	}), "dsh-mobile: pwa chrome");
	ctx.logger.info(`dsh-mobile: 📱 手机 / iPad 访问: ${lanUrl}`);
	if (primary !== void 0) try {
		const terminal = await QRCode.toString(lanUrl, {
			type: "terminal",
			small: true
		});
		ctx.logger.info("dsh-mobile: 终端二维码(手机相机扫):\n" + terminal);
	} catch {}
	ctx.logger.info("dsh-mobile: 桌面浏览器打开 http://127.0.0.1:" + String(loopbackPort) + "/mobile 可显示大二维码");
	ctx.logger.warn(WARNING);
}
//#endregion
export { DEFAULT_LAN_PORT, LanProxy, apply, iconPng, inject, installPwa, lanAddresses, name };
