# dsh-mobile

> Use **DeepSeek Harness from your iPhone / iPad**: LAN reverse proxy + iOS PWA (add-to-home-screen) + touch/mobile CSS for the web GUI.

![MIT](https://img.shields.io/badge/license-MIT-blue) ![DSH plugin](https://img.shields.io/badge/dsh-plugin-4f7cf7)

[中文](README.md)

DeepSeek Harness's web GUI binds to `127.0.0.1` by default (upstream deliberately rejects `--host 0.0.0.0` for safety). This plugin adds a first-class mobile experience:

- **📱 LAN access** — the plugin runs its own `0.0.0.0` reverse proxy that forwards phone/iPad traffic to the loopback server, rewriting `Host`/`Origin` so the `/api` trust fence accepts it (HTTP and WebSocket upgrades included). The LAN URL and a terminal QR code are printed on startup.
- **🍎 iOS PWA shell** — injects `apple-mobile-web-app-capable`, `viewport-fit=cover`, `apple-touch-icon`, programmatically generated PNG icons, and an enhanced `manifest.webmanifest`. After "Add to Home Screen" in Safari it opens fullscreen like a native app with its own icon.
- **👆 Touch adaptation** — mobile CSS: inputs ≥16px to prevent iOS focus zoom, `touch-action: manipulation` to kill double-tap delay, notch / home-indicator safe-area insets, raising the composer above the on-screen keyboard (visualViewport tracking), and larger tap targets for message actions.
- **🔳 /mobile QR page** — open `http://127.0.0.1:3080/mobile` on the desktop to get a big QR code plus step-by-step instructions; the phone camera opens the LAN URL in one scan.

## ⚠️ Security warning (read first)

**Enabling this plugin exposes the full Harness — including its code-execution tools — to every device on your LAN.** That is the price of "usable from a phone". Please:

- only keep it enabled on a **network you trust** (e.g. your home Wi-Fi);
- on public/untrusted networks, comment out the `mobile` row in `cordis.patch.yml` and restart;
- optionally restrict access to specific phone IPs with the `allow` config (see below).

## 🔧 Harness source patches (by need — no dsh-webchatlike dependency)

**dsh-mobile itself does NOT depend on dsh-webchatlike** — a stock harness without webchatlike works fine. Patches are applied as needed:

| Patch | Required? | Notes |
|---|---|---|
| Secure-context UUID | ✅ Required | Upstream bug: `mintRpcId()` uses `crypto.randomUUID`, a **[SecureContext]-only** API. `http://127.0.0.1` is a trustworthy origin (local GUI fine), but a phone on a LAN IP is NOT a secure context → `randomUUID` is `undefined` → every RPC throws → the connection handshake fails → the page spins forever. Patches the stock files; unrelated to webchatlike. |
| webchatlike folding fallback | ⚪ Only with dsh-webchatlike | Fixes webchatlike's version-family folding on fresh browsers (no localStorage ledger): phones showed every regenerate/edit fork as an independent row and clicking the folded row did nothing. Not needed without webchatlike — stock harness never folds. |

### Patch 1: Secure-context UUID (required)

| File | Change |
|---|---|
| `packages/host/apiproxy/src/fetch/client.ts` | `mintRpcId()` mints a v4 UUID from `crypto.getRandomValues` (core fix) |
| `packages/client/ui-conversation/src/client/service.ts` | Draft attachment ids use the same fallback |
| `packages/llm/llm/src/message.ts` | Message ids use the same fallback |

```bash
cd /path/to/deepseek-harness
pnpm run build:lib:client   # the running GUI hot-swaps client bundles; no restart needed
```

> All patches are backed up in `harness-patches/` for re-application after upstream updates.

### Patch 2: webchatlike folding fallback (optional, only with dsh-webchatlike)

`packages/client/ui-workspace/src/client/tree.ts`, `WorkspaceBrowser.tsx`, `index.ts` — also backed up in `harness-patches/`.

## Install from GitHub

Repository: **github.com/cindyguyuehu123/dsh-mobile** (built `lib/` ships with the repo — no build step needed)

Option 1 — official plugin command (clones and installs dependencies automatically):

```bash
dsh plugin --profile web add https://github.com/cindyguyuehu123/dsh-mobile.git
```

Option 2 — manual registration (same as dsh-webchatlike):

```bash
# 1. Clone and install dependencies
git clone https://github.com/cindyguyuehu123/dsh-mobile.git
cd dsh-mobile && pnpm install

# 2. Add to ~/.dsh/profiles/web/package.json dependencies
#    "dsh-mobile": "link:/absolute/path/dsh-mobile"
cd ~/.dsh/profiles/web && pnpm install

# 3. Insert into ~/.dsh/profiles/web/cordis.patch.yml
# - insert:
#     - id: mobile
#       name: 'dsh-mobile'
```

## Install (manual, detailed)

### 1. Build

```bash
cd /path/to/dsh-mobile
pnpm install
pnpm run build
```

Outputs: `lib/index.js` (host half) and `lib/client.js` (browser half, zero runtime imports).

### 2. Register in the profile

Edit `~/.dsh/profiles/web/package.json` and add a link dependency:

```json
"dependencies": {
  "dsh-mobile": "link:/path/to/dsh-mobile"
}
```

Then:

```bash
cd ~/.dsh/profiles/web && pnpm install
```

Edit `~/.dsh/profiles/web/cordis.patch.yml`, insert the loader row:

```yaml
- insert:
    - id: mobile
      name: 'dsh-mobile'
```

### 3. Restart

```bash
cd /path/to/deepseek-harness
pnpm dsh web
```

The log prints:

```
dsh-mobile: 📱 phone / iPad access: http://192.168.x.x:3090
dsh-mobile: desktop QR page: http://127.0.0.1:3080/mobile
```

## Usage

1. Phone/iPad on the **same Wi-Fi** as the Mac;
2. Scan the QR on the desktop `/mobile` page (or type the printed URL);
3. In Safari: **Share → Add to Home Screen** for a native-app-like icon.

## Configuration

The plugin row accepts an optional `config` (all optional):

```yaml
- insert:
    - id: mobile
      name: 'dsh-mobile'
      config:
        lanPort: 3090     # proxy port; walks +1 when busy (default 3090)
        allow: []         # optional client-IP allowlist, e.g. ['192.168.1.20']; empty = allow all
```

## How it works (no harness source changes needed for the plugin itself)

- The upstream WebServer's `/api` routes and WebSocket upgrades all pass `isTrustedApiRequest`: loopback `Host` passes, `Origin` (when present) must be same-origin. The proxy rewrites `Host` to `127.0.0.1:<loopback port>` and same-origin `Origin` accordingly, so phone traffic looks exactly like local traffic to the core server — **no harness source modification**, and the blocked `--host 0.0.0.0` is never touched.
- PWA parts use the public `webServer.tapIndex()` and route-registration extension points.
- The browser half rides the standard `dsh.client` channel (`/plugins/dsh-mobile/client.js`), same loading path as the shipped ui-* plugins.

## Development

```bash
pnpm run build        # build lib/ via tsdown
pnpm run typecheck    # tsc --noEmit
```

Client-side changes hot-swap into a running GUI (bundle polling); host-side changes need a `dsh web` restart.

## Known limitations

- LAN-only (or your own tunnel): the phone cannot reach the Mac over cellular.
- macOS may ask once to allow Node.js to accept incoming connections — allow it.
- Real-device keyboard/safe-area behavior is covered for mainstream iOS, but minor per-version differences may remain.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Cannot connect" / endless spinner | Phone not on the same network, router **AP isolation**, or iOS **Local Network** permission off | Same Wi-Fi; disable AP isolation on the router; Settings → Privacy & Security → Local Network → enable browser |
| Blank spinning page | Old cached bundle (pre-fix) | Refresh; private window; clear Safari cache |
| Works on Mac only | macOS firewall | System Settings → Network → Firewall → allow Node.js |


