# Google Cloud 币安预警守护部署经验

更新时间：2026-05-10

本文记录 `binance-alert-daemon` 部署到 Google Cloud VM 的实际经验，供后续迁移、重建、排障使用。文档不保存 Telegram token、chat_id 等敏感信息。

## 当前成功部署状态

- Google 账号：`599267295@qq.com`
- Project ID：`gen-lang-client-0499133969`
- 项目名：`Default Gemini Project`
- 成功实例：`quantum-binance-alert-asia`
- 区域：`asia-east1-b`
- 规格：`e2-micro`
- 系统：Debian 12
- 服务名：`quantum-binance-alert.service`
- 程序目录：`/opt/quantum-alert`
- 当前公网 IP：`35.234.27.229`

验证日志中应出现：

```text
Binance alert daemon starting
Monitoring 50 Binance symbols
WebSocket connected (all-market miniTicker stream, filtered to 50 symbols)
Telegram ranking broadcast sent
```

## 核心结论

1. 不要用美国区跑 Binance。
   `us-central1` 可以创建实例，但 Binance API 返回 `451 Region Restricted`。后续优先使用 `asia-east1-b` 等非美国区。

2. 云端不启用桌面通知。
   Linux VM 没有 Windows 通知环境，云端配置应设置：

```json
{
  "desktop_notify": { "enabled": false },
  "ranking_broadcast": { "desktop_enabled": false }
}
```

3. JSON 文件必须是 UTF-8 无 BOM。
   如果配置文件带 BOM，Node 会报：

```text
SyntaxError: Unexpected token ﻿ in JSON at position 0
```

4. Google Cloud Console 页面创建不稳定时，优先使用本机 `gcloud`。
   这次浏览器控制台创建按钮没有落实例，Cloud Shell 也频繁断开。本机安装 Google Cloud CLI 后最稳定。

5. 如果本机存在代理变量，`gcloud` 可能出现两类问题：
   直连可能 timeout；走代理时大请求可能 TLS 报错。可先用小请求创建空 VM，再用 `scp/ssh` 上传部署包。

## 本地准备

构建轻量守护进程：

```powershell
npm run build:alert-daemon
```

云端部署包建议包含：

```text
dist-alert/binance-alert-daemon.cjs
alert-daemon.config.json
Quantum_Monitor_System/1_Core_Engine/settings.json
```

云端 `settings.json` 需要去掉本地代理：

```json
{
  "ApiEndpointSettings": {
    "socks_proxy": "",
    "https_proxy": ""
  }
}
```

打包前建议强制转 UTF-8 无 BOM：

```powershell
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
foreach ($p in @(
  ".runtime\gcp-deploy\alert-daemon.config.json",
  ".runtime\gcp-deploy\Quantum_Monitor_System\1_Core_Engine\settings.json"
)) {
  $text = [IO.File]::ReadAllText((Resolve-Path $p), [Text.Encoding]::UTF8)
  if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
  [IO.File]::WriteAllText((Resolve-Path $p), $text, $utf8NoBom)
}
```

## gcloud 初始化

安装 Google Cloud CLI：

```powershell
winget install --id Google.CloudSDK --accept-package-agreements --accept-source-agreements --silent
```

本机路径通常是：

```powershell
$gcloud = "C:\Users\ligongzi\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
```

登录并设置项目：

```powershell
& $gcloud auth login --launch-browser --brief
& $gcloud config set project gen-lang-client-0499133969
& $gcloud auth list --format="value(account)"
```

确认输出账号是 `599267295@qq.com`。

## 创建亚洲实例

```powershell
& $gcloud compute instances create quantum-binance-alert-asia `
  --project=gen-lang-client-0499133969 `
  --zone=asia-east1-b `
  --machine-type=e2-micro `
  --image-family=debian-12 `
  --image-project=debian-cloud `
  --boot-disk-size=10GB `
  --boot-disk-type=pd-standard `
  --labels=app=quantum-binance-alert `
  --quiet
```

不要先创建美国区实例。若已创建美国区且遇到 Binance 451，直接迁移后删除。

## 上传并安装

上传部署包和 systemd 文件：

```powershell
& $gcloud compute scp .runtime\alert-daemon-gcp-deploy.zip quantum-binance-alert-asia:/tmp/alert-daemon-gcp-deploy.zip `
  --project=gen-lang-client-0499133969 --zone=asia-east1-b --quiet

& $gcloud compute scp .runtime\quantum-binance-alert.service quantum-binance-alert-asia:/tmp/quantum-binance-alert.service `
  --project=gen-lang-client-0499133969 --zone=asia-east1-b --quiet
```

远程安装：

```powershell
$cmd = "sudo apt-get update && sudo apt-get install -y nodejs unzip ca-certificates && sudo mkdir -p /opt/quantum-alert && sudo unzip -o /tmp/alert-daemon-gcp-deploy.zip -d /opt/quantum-alert && sudo cp /tmp/quantum-binance-alert.service /etc/systemd/system/quantum-binance-alert.service && sudo systemctl daemon-reload && sudo systemctl enable --now quantum-binance-alert && sleep 12 && sudo systemctl --no-pager --full status quantum-binance-alert || true; sudo journalctl -u quantum-binance-alert -n 120 --no-pager"

& $gcloud compute ssh quantum-binance-alert-asia `
  --project=gen-lang-client-0499133969 `
  --zone=asia-east1-b `
  --command=$cmd `
  --quiet
```

`quantum-binance-alert.service` 内容：

```ini
[Unit]
Description=Quantum Binance Alert Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/quantum-alert
ExecStart=/usr/bin/node /opt/quantum-alert/dist-alert/binance-alert-daemon.cjs
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

## 验证命令

```powershell
& $gcloud compute ssh quantum-binance-alert-asia `
  --project=gen-lang-client-0499133969 `
  --zone=asia-east1-b `
  --command="sudo systemctl is-active quantum-binance-alert; sudo journalctl -u quantum-binance-alert -n 120 --no-pager" `
  --quiet
```

成功标准：

- `systemctl is-active` 输出 `active`
- 日志有 `WebSocket connected`
- 日志有 `Telegram ranking broadcast sent`
- Telegram 收到排名表

查看资源：

```powershell
& $gcloud compute ssh quantum-binance-alert-asia `
  --project=gen-lang-client-0499133969 `
  --zone=asia-east1-b `
  --command="ps -o pid,rss,pcpu,cmd -C node; free -h" `
  --quiet
```

本次实测 Node 进程约 `68MB`。

## 迁移实例内容

如果旧实例已经有 `/opt/quantum-alert`，可以直接迁移目录和 service，而不重新构建：

```bash
sudo tar -C /opt -czf /tmp/quantum-alert.tgz quantum-alert
sudo cp /etc/systemd/system/quantum-binance-alert.service /tmp/
```

再用 `gcloud compute scp` 拉回本机并传到新实例。新实例恢复：

```bash
sudo mkdir -p /opt
sudo tar -C /opt -xzf /tmp/quantum-alert.tgz
sudo cp /tmp/quantum-binance-alert.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now quantum-binance-alert
```

迁移后仍要验证非美国区是否能访问 Binance。

## 清理失败实例

美国区失败实例删除命令：

```powershell
& $gcloud compute instances delete quantum-binance-alert `
  --project=gen-lang-client-0499133969 `
  --zone=us-central1-a `
  --quiet
```

确认只剩亚洲区实例：

```powershell
& $gcloud compute instances list --project=gen-lang-client-0499133969
```

## 常见错误

### `451 Region Restricted`

原因：实例公网 IP 所在地区被 Binance.com 限制。

处理：换非美国区实例，例如 `asia-east1-b`。

### `Unexpected token ﻿ in JSON at position 0`

原因：JSON 文件带 UTF-8 BOM。

处理：用 `utf-8-sig` 读入再按 UTF-8 无 BOM 写出。

### Cloud Shell 输入不稳定

现象：断连、长脚本粘贴失败、命令不执行。

处理：使用本机 `gcloud`，避免依赖 Cloud Shell。

### 首次 SSH 卡 host key

现象：提示 `Store key in cache?`

处理：可手动输入 `y`，或在自动化时通过管道输入。

### Windows PowerShell 引号被 gcloud 解析错

现象：`gcloud compute ssh --command` 把复杂命令拆成多个参数。

处理：复杂脚本优先写成本地文件，通过 `gcloud compute scp` 上传后执行，避免在一行里嵌套多层引号。

## 后续维护

重启服务：

```powershell
& $gcloud compute ssh quantum-binance-alert-asia --project=gen-lang-client-0499133969 --zone=asia-east1-b --command="sudo systemctl restart quantum-binance-alert && sudo systemctl status quantum-binance-alert --no-pager" --quiet
```

停止服务：

```powershell
& $gcloud compute ssh quantum-binance-alert-asia --project=gen-lang-client-0499133969 --zone=asia-east1-b --command="sudo systemctl stop quantum-binance-alert" --quiet
```

更新程序：

1. 本地重新构建 `dist-alert/binance-alert-daemon.cjs`。
2. 重新打包 `.runtime\alert-daemon-gcp-deploy.zip`。
3. 上传到 `/tmp/alert-daemon-gcp-deploy.zip`。
4. 解压覆盖 `/opt/quantum-alert`。
5. `sudo systemctl restart quantum-binance-alert`。

