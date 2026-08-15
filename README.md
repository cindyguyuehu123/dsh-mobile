# dsh-mobile

> 让 **DeepSeek Harness Web GUI 在 iPhone / iPad 上也能用**:局域网反向代理 + iOS PWA(添加到主屏幕)+ 触屏适配。

DeepSeek Harness 的 Web GUI 默认只监听 `127.0.0.1`(上游出于安全**刻意禁止** `--host 0.0.0.0`)。本插件为它补齐手机端体验:

- **📱 局域网访问** —— 插件自己起一个 `0.0.0.0` 反向代理,把手机/iPad 的请求转发给回环服务,并改写 `Host`/`Origin` 通过 `/api` 信任栅栏(HTTP 与 WebSocket 升级都支持)。启动时打印局域网地址和终端二维码。
- **🍎 iOS PWA 外壳** —— 注入 `apple-mobile-web-app-capable`、`viewport-fit=cover`、`apple-touch-icon` 等元信息,程序化生成 PNG 图标,增强 `manifest.webmanifest`。Safari「添加到主屏幕」后像原生 App 一样全屏打开,带独立图标。
- **👆 触屏适配** —— 注入移动端 CSS:输入框 ≥16px 防 iOS 聚焦缩放、`touch-action: manipulation` 去掉双击缩放延迟、iPhone 刘海/Home 指示条安全区留白、软键盘弹出时把输入区抬到键盘上方(visualViewport 监测)、消息操作按钮增大点按目标。
- **🔳 /mobile 扫码页** —— 桌面浏览器打开 `http://127.0.0.1:3080/mobile` 显示大二维码 + 步骤说明,手机相机一扫即开。

## ⚠️ 安全警告(必读)

**启用本插件后,同一局域网内的所有设备都能访问你的 Harness,并且可以完全驱动它——包括执行代码的工具。** 这不是瑕疵,是"手机能用"的前提。请务必:

- 只在**你自己信任的网络**(如家里 Wi-Fi)开启;
- 连接公共/陌生 Wi-Fi 时,从 `cordis.patch.yml` 移除 `mobile` 行(或临时把行注释掉)再重启;
- 可选:用 `allow` 配置只放行指定手机 IP(见下文)。

## 🔧 依赖 1 个 harness 源码补丁(必须)

**上游 bug**:客户端 `mintRpcId()` 使用 `crypto.randomUUID`,而该 API 只在**安全上下文**可用。`http://127.0.0.1` 是可信源(所以本机正常),但手机经局域网 IP 访问时**不是安全上下文**,`randomUUID` 为 undefined → 每个 RPC 都抛错 → 连接握手失败 → 手机端**一直转圈白屏**。

需要给 harness 源码打一个小补丁(已备份在 `harness-patches/`):

| 文件 | 改动 |
|---|---|
| `packages/host/apiproxy/src/fetch/client.ts` | `mintRpcId()` 改用 `crypto.getRandomValues` 生成 v4 UUID(核心修复) |
| `packages/client/ui-conversation/src/client/service.ts` | 附件草稿 id 同样替换 |
| `packages/llm/llm/src/message.ts` | 消息 id 同样替换 |

```bash
cd /path/to/deepseek-harness
pnpm run build:lib:client   # 客户端 bundle 会被运行中的 GUI 自动热替换
```

## 安装

### 1. 构建

```bash
cd /path/to/dsh-mobile
pnpm install
pnpm run build
```

产物:`lib/index.js`(host 半)与 `lib/client.js`(浏览器半,零外部依赖)。

### 2. 注册到 profile

编辑 `~/.dsh/profiles/web/package.json`,加入 link 依赖:

```json
"dependencies": {
  "dsh-mobile": "link:/path/to/dsh-mobile"
}
```

然后:

```bash
cd ~/.dsh/profiles/web && pnpm install
```

编辑 `~/.dsh/profiles/web/cordis.patch.yml`,插入 loader 行:

```yaml
- insert:
    - id: mobile
      name: 'dsh-mobile'
```

### 3. 重启

```bash
cd /path/to/deepseek-harness
pnpm dsh web
```

启动日志会打印:

```
dsh-mobile: 📱 手机 / iPad 访问: http://192.168.x.x:3090
dsh-mobile: 桌面浏览器打开 http://127.0.0.1:3080/mobile 可显示大二维码
```

## 使用

1. 手机/iPad **连同一个 Wi-Fi**;
2. 用 iPhone/iPad 的**相机**扫桌面 `/mobile` 页的大二维码(或直接输入日志里的地址);
3. Safari 打开后点 **分享 → 添加到主屏幕**,以后从主屏幕图标像原生 App 一样进入。

## 配置

插件行可以带 `config`(可省略):

```yaml
- insert:
    - id: mobile
      name: 'dsh-mobile'
      config:
        lanPort: 3090     # 代理端口,占用时自动 +1 尝试(默认 3090)
        allow: []         # 可选:只允许这些客户端 IP(如 ['192.168.1.20']);空 = 放行全部
```

## 工作原理(为什么不需要改 harness 源码)

- 上游 WebServer 的 `/api` 与 WebSocket 升级都经过 `isTrustedApiRequest` 信任栅栏:回环 `Host` 放行,`Origin`(如有)必须同源。本插件的代理把 `Host` 改写成 `127.0.0.1:<回环端口>`,把同源 `Origin` 同步改写,所以手机流量在核心服务器看来和本地流量完全一致——**不修改 harness 一行源码**,也不需要碰被禁用的 `--host 0.0.0.0`。
- PWA 部分走上游公开的 `webServer.tapIndex()` 与路由注册扩展点,同样是纯增量。
- 浏览器半走标准 `dsh.client` 通道(`/plugins/dsh-mobile/client.js`),与内置 ui-* 插件同一条加载链路。

## 开发

```bash
pnpm run build        # 构建 lib/ (tsdown)
pnpm run typecheck    # tsc --noEmit
```

改动 `src/client/` 后重新 build,正在运行的 GUI 会通过 client-modules 的 bundle 轮询热替换,不用重启页面(host 半改动需要重启 `dsh web`)。

## 已知边界

- 只能在同一局域网(或你自行打通的路由)内访问;手机走蜂窝网络时无法直连 Mac。
- macOS 首次监听 `0.0.0.0` 时,系统防火墙可能弹窗询问是否允许 Node.js 接受传入连接,选「允许」。
- 真实设备上的键盘/安全区表现以 iPhone/iPad 实测为准(本插件的 JS 逻辑已覆盖主流情况,但不同 iOS 版本细节略有差异)。
