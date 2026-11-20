# 悬浮信息接收器

一个最小化的安卓消息接收 App：云电脑通过 HTTP 发送消息，手机通过 WebSocket 实时接收，并用可拖动悬浮窗显示 Markdown。

## 功能范围

- Android 8.0 及以上
- 小悬浮窗、拖动、边缘吸附、点击展开
- 可调悬浮窗宽度与透明度
- Markdown 标题、表格、粗体、列表、代码和链接
- 前台服务与自动重连
- 服务端保留最近 50 条，重连时补发
- Token 鉴权和 32 KB 消息限制

不包含账号、手机消息历史、回复、多设备状态同步和系统通知自动抓取。

## 1. 云电脑启动发送服务

需要 Python 3.10 或更高版本。

### PowerShell

```powershell
cd sender
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:RECEIVER_TOKEN = "替换成至少16位的随机Token"
uvicorn app:app --host 127.0.0.1 --port 8765
```

### Linux

```bash
cd sender
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export RECEIVER_TOKEN="替换成至少16位的随机Token"
uvicorn app:app --host 127.0.0.1 --port 8765
```

正式使用时，通过 Caddy 或 Cloudflare Tunnel 提供 HTTPS/WSS。`Caddyfile.example` 展示了有域名时的最小配置。

## 2. 配置安卓 App

假设服务地址为 `https://receiver.example.com`：

- WebSocket 地址：`wss://receiver.example.com/ws`
- Token：与 `RECEIVER_TOKEN` 完全一致
- 授予悬浮窗权限
- 授予通知权限
- 点击“启动接收”

Debug APK 允许 `ws://`，Release APK 只允许加密连接。

## 3. 发送消息

### PowerShell

```powershell
.\sender\send_message.ps1 `
  -ServerUrl "https://receiver.example.com" `
  -Token "你的Token" `
  -Title "构建完成" `
  -Body "## 成功`n`nAPK 已经生成。" `
  -Level success
```

### Linux

```bash
sh ./sender/send_message.sh \
  "https://receiver.example.com" \
  "你的Token" \
  "构建完成" \
  "**APK 已经生成**" \
  success
```

## 4. 云端构建 APK

将 `floating-receiver` 目录作为 GitHub 仓库推送。GitHub Actions 会执行单元测试并生成：

```text
app/build/outputs/apk/debug/app-debug.apk
```

在仓库的 Actions 页面下载 `floating-receiver-debug` 构建产物。

## 本地测试

没有服务器时，可以安装 APK、授予悬浮窗权限，然后点击“测试悬浮窗”。

服务端测试：

```bash
cd sender
pip install -r requirements-dev.txt
pytest -q
```
