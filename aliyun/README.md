# Quantum Monitor 阿里云部署与运维手册（AI 新对话交接指南）

> **给未来 AI 助手的说明**：如果用户要求查看、修改、增删品种、排查日志或重新部署阿里云上的无 UI 行情监控程序，**先读本文件**。
> **安全红线**：严禁在回复、日志或公开 Git 提交中打印或泄露 Telegram `bot_token`、`chat_id`、微信 iLink `token`、SSH 私钥或 `.env` 内容。

---

## 1. 服务器与服务概况

- **云厂商 / 地域**：阿里云 ECS（`cn-hongkong`，中国香港 C）
- **实例 ID**：`i-j6cch8046l3vexqajegj`（安全组：`sg-j6cch8046l3vexqcydlx`）
- **公网 IP**：`47.83.122.79`
- **硬件配置**：2 vCPU / 1.7 GiB RAM + 1.0 GiB Swap（`/swapfile`）/ 40 GB 磁盘 / Ubuntu 22.04
- **系统优化**：已停用并屏蔽 `fwupd`（释放 160 MB 内存）；`journald` 日志体积上限 `200M / 14day`
- **运行服务**：
  1. **`quantum-binance-alert.service`**（Node.js v20，非 root 专用用户 `quantum` 运行，内存限额 `384M/512M`，程序目录 `/opt/quantum-alert`）
  2. **`ntfy.service`**（Go 自建手机推送服务端，监听 TCP `8090`，安全组已放行，内存限额 `128M/192M`，配置文件 `/etc/ntfy/server.yml`）

---

## 2. 监控与推送架构

### 行情监控范围
1. **币安纯加密货币永续合约 Top 20**（自动按 24H 成交额每 4 小时动态刷新）：
   - 主网 REST：`https://fapi.binance.com`
   - 主网行情流 WebSocket：**`wss://fstream.binance.com/market/stream`**（注意：旧路径 `/stream` 0 帧无数据，切勿改回）
   - 通过 `/fapi/v1/exchangeInfo` 正向过滤 `status=TRADING && contractType=PERPETUAL && underlyingType=COIN && quoteAsset=USDT`，自动隔离美股/商品 TradFi 合约与稳定币。
   - 异动阈值：90 秒窗口 `3%`。
2. **固定自选 Watchlist（13 个标的，每 15 秒轮询，90 秒异动阈值 `1%`）**：
   - 外盘期货：`GC1!`（黄金）、`CL1!`（石油）、`ZC1!`（美玉米）
   - 国内期货：`C0`（国内玉米主力，自动降级走新浪 K 线接口）
   - 美股：`NVDA`、`MU`、`QQQ`、`SPY`、`NOK`、`SKHY`、`ANT`（Anthropic）、`SPCX`
   - 币安 24H 固定自选：`SAMSUNGUSDT`（三星电子）
   - 已内置 **K 线时间戳防倒退** + **盘前单点价格毛刺 2 帧确认防抖** + **本地 15m 历史计算 & Yahoo Keep-Alive 连接复用**。

### 推送通道
- **Telegram（主推送 + 远程指令）**：实时异动告警 + 每 10 分钟排行播报 + 25s 长轮询响应 `/status` `/top` `/symbol` `/config`。
- **ntfy 自建手机推送（免翻墙直连）**：
  - 手机 App（免谷歌版，开启 WebSockets）：服务器 `http://47.83.122.79:8090`，Topic 见本地 `alert-daemon.config.json` 的 `ntfy.topic`。
  - 实时异动告警：`priority=4`（高，响铃弹窗，已精简掉窗口低/高点、快照行与重复当前价行）。
  - 每 10 分钟排行播报：`priority=2`（低，静默展示）。
- **微信 iLink**：仅保留**手动指令查询**（随时发 `/status` `/top` 秒回）；因微信 iLink 协议 `context_token` 约 15 分钟失效，已关闭被动定时广播与告警推送，避免 `ret=-2` 报错。

---

## 3. 本地密钥与配置文件位置（仅存本机，不上传 GitHub）

> 以下文件均已被 `.gitignore` 严格排除，不会进入公开 Git 仓库：

- **SSH 免密私钥**：`C:\Users\ligongzi\.ssh\aliyun_remix_ed25519`（本地备份副本位于 `aliyun\local-secrets\`）
- **守护进程实际配置**（含 Telegram Token / Chat ID / ntfy Topic / 自选列表）：`d:\AI\remix\alert-daemon.config.json`
- **核心接口配置**：`d:\AI\remix\Quantum_Monitor_System\1_Core_Engine\settings.json`
- **微信 iLink 凭证**：`d:\AI\remix\.runtime\weixin\token.json` & `state.json`
- **本地完整私密备份目录**：`d:\AI\remix\aliyun\local-secrets\`

---

## 4. 常用一键命令（在 `d:\AI\remix` PowerShell 下执行）

### 一键构建并发布到阿里云（改代码或改配置后）
```powershell
powershell -ExecutionPolicy Bypass -File .\aliyun\deploy-aliyun-alert.ps1
```
*(若只改了 `alert-daemon.config.json`，可加 `-SkipBuild` 跳过编译秒传)*

### 一键检查服务器占用、服务状态与最新日志
```powershell
powershell -ExecutionPolicy Bypass -File .\aliyun\check-aliyun-status.ps1
```

### 本机 SSH 注意事项（FlClash TUN 绕行）
本机开启 FlClash TUN 时直连 22 端口会被代理节点拦截，所有脚本已自动检测局域网物理网卡 IP 并传入 `-o BindAddress=<LAN_IP>` 直连。

---

## 5. 增删自选监控品种步骤
1. 编辑本地 `alert-daemon.config.json` 中的 `watchlist.items`（支持 `Stocks_US`、`Futures_Global`、`Futures_CN`、`Crypto_Binance` 四种市场）。
2. 执行 `powershell -ExecutionPolicy Bypass -File .\aliyun\deploy-aliyun-alert.ps1 -SkipBuild`。
3. 执行 `.\aliyun\check-aliyun-status.ps1` 确认新标的在首条广播中正常出数且 0 报错。
