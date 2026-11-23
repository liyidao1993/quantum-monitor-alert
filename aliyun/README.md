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
1. **币安纯加密货币永续合约 Top 30**（自动按 24H 成交额每 4 小时动态刷新）：
   - 主网 REST：`https://fapi.binance.com`
   - 主网行情流 WebSocket：**`wss://fstream.binance.com/market/stream`**（注意：旧路径 `/stream` 0 帧无数据，切勿改回）
   - 通过 `/fapi/v1/exchangeInfo` 正向过滤 `status=TRADING && contractType=PERPETUAL && underlyingType=COIN && quoteAsset=USDT`，自动隔离美股/商品 TradFi 合约与稳定币。
   - **90 秒瞬时异动规则**：阈值 `5%`；触发后**立即清空滑动窗口**（以触发价为新起点），且已**解除时间冷却与次数上限**（`base_seconds=0`、`max_alerts_per_symbol_per_10min=0`、`separate_up_down=true`）。
   - **MA60 偏离**：后台持续计算 `1m / 15m / 1d` 偏离并展示在 10 分钟定时播报中；主动 MA60 异动预警当前关闭（`ma60_alerts.enabled=false`）。
2. **大盘指数浓缩对照区 + 固定自选 Watchlist（共 20 个标的，每 15 秒轮询，全部开启实时异动）**：
   - **A 股三大指数**（`Stocks_CN`，`group=index_cn`，`alert_enabled=true`）：`SH000001`（上证）、`SZ399006`（创业）、`SH000688`（科创）；主通道走东方财富实时接口，异常自动回退 Yahoo Finance。
   - **美股三大指数**（`Stocks_US`，`group=index_us`，`alert_enabled=true`）：`^GSPC`（标普）、`^IXIC`（纳指）、`^DJI`（道指）；Yahoo `range=1d` 直取 `meta.chartPreviousClose` 保证昨收精度。
   - **其余 14 个自选标的**（与 6 大指数同样适用 90 秒 `1%` 阈值，无冷却、无 10 分钟次数上限，且关闭 2 帧防抖等待 `watchlist_confirm_spike=false`）：
     - 币安 24H 固定自选：`BTCUSDT`（比特币）、`SAMSUNGUSDT`（三星电子）
     - 外盘期货：`GC1!`（黄金）、`CL1!`（石油）、`ZC1!`（美玉米，周末休市自动回退 `meta.regularMarketPrice`）
     - 国内期货：`C0`（国内玉米主力，自动降级走新浪 K 线接口）
     - 美股：`NVDA`、`MU`、`QQQ`、`SPY`、`NOK`、`SKHY`、`ANT`（Anthropic）、`SPCX`
   - 已内置 **K 线时间戳防倒退** + **本地 15m 历史计算 & Yahoo Keep-Alive 连接复用**（单点毛刺 2 帧确认防抖已通过 `watchlist_confirm_spike=false` 关闭，按需可重新开启）。

### 推送通道
- **ntfy 自建手机推送（当前主力，免翻墙直连）**：
  - 手机 App（免谷歌版，开启 WebSockets）：服务器 `http://47.83.122.79:8090`，Topic 见本地 `alert-daemon.config.json` 的 `ntfy.topic`。
  - 实时异动告警：`priority=4`（高，响铃弹窗，精简 2 行去重文案）。
  - 每 10 分钟定时播报：`priority=2`（低，静默展示）；采用紧凑对齐等宽排版，**👀 自选快照**最顶部为 4 行 3 列浓缩指数对照区（A 股在上、美股居下，方便互相参照），下方紧接自选明细。
- **Telegram**：支持实时异动、排行播报与 25s 长轮询指令（`/status` `/top` `/symbol` `/config`），当前默认关闭（`telegram.enabled=false`），需要时可随时在配置中重新开启。
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
1. 编辑本地 `alert-daemon.config.json` 中的 `watchlist.items`（支持 `Stocks_CN`、`Stocks_US`、`Futures_Global`、`Futures_CN`、`Crypto_Binance` 五种市场，可选 `group: "index_cn" | "index_us"` 与 `alert_enabled: false`）。
2. 同步复制 `alert-daemon.config.json` 到 `aliyun\local-secrets\alert-daemon.config.json`（不提交 GitHub）。
3. 执行 `powershell -ExecutionPolicy Bypass -File .\aliyun\deploy-aliyun-alert.ps1 -SkipBuild`。
4. 执行 `.\aliyun\check-aliyun-status.ps1` 确认新标的在首条广播中正常出数且 0 报错。
