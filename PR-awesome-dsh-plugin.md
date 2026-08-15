# awesome-dsh-plugin 收录 PR 文案

提交 PR 到 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin (PRs welcome)。
把 `cindyguyuehu123` 换成你的 GitHub 用户名。两个文件都要改,各加一行。

## README.md (English) — under `### UI Enhancements`

```markdown
- [cindyguyuehu123/dsh-mobile](https://github.com/cindyguyuehu123/dsh-mobile) - Use DSH from iPhone/iPad: an explicit-opt-in LAN reverse proxy that survives the loopback-only trust fence (Host/Origin rewrite, WebSocket upgrades included), iOS PWA chrome (add-to-home-screen icon, standalone meta, viewport-fit), and touch/mobile CSS (safe areas, keyboard lifting, no focus zoom, composer row fit).
```

## README.zh.md (中文) — 在 `### UI 增强` 下

```markdown
- [cindyguyuehu123/dsh-mobile](https://github.com/cindyguyuehu123/dsh-mobile) — 让 DSH 在 iPhone/iPad 上可用：显式开启的局域网反向代理（改写 Host/Origin 通过回环信任栅栏，含 WebSocket 升级）、iOS PWA 外壳（主屏幕图标、standalone meta、viewport-fit）、触屏/移动端 CSS（安全区、键盘避让、防聚焦缩放、输入框按钮行适配）。
```

## PR 标题

```
add dsh-mobile: LAN reverse proxy + iOS PWA + touch CSS for iPhone/iPad
```

## PR 描述(可复制)

```markdown
Adds [dsh-mobile](https://github.com/cindyguyuehu123/dsh-mobile) to **UI Enhancements**.

Use the DeepSeek Harness web GUI from iPhone / iPad:

- 📱 **LAN reverse proxy** — the upstream WebServer deliberately rejects `--host 0.0.0.0`; the plugin owns an explicit `0.0.0.0` proxy that forwards HTTP and WebSocket upgrades to the loopback server, rewriting `Host`/`Origin` so the `/api` browser-trust fence accepts phone traffic exactly like local traffic. LAN URL + terminal QR printed on startup, plus a `/mobile` QR landing page.
- 🍎 **iOS PWA shell** — `apple-mobile-web-app-capable`, `viewport-fit=cover`, `apple-touch-icon`, programmatic PNG icons, enhanced manifest; Safari "Add to Home Screen" opens fullscreen like a native app.
- 👆 **Touch/mobile CSS** — safe-area insets, keyboard lifting via visualViewport, no iOS focus zoom (≥16px inputs), composer action-row fit on narrow screens, larger tap targets.
- 🔧 Sits on one required harness source patch (secure-context UUID: `crypto.randomUUID` is [SecureContext]-only, so LAN-origin pages crashed every RPC until `mintRpcId()` gained a `getRandomValues` fallback) — backed up in `harness-patches/` for re-application.

Install: `dsh plugin --profile web add https://github.com/cindyguyuehu123/dsh-mobile.git` (declares `dsh.bundle`).

Repo topic `dsh-plugin` is set.
```


