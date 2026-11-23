# Quantum Monitor 项目交接文档（AI 快速接管指南）

> **一句话定位**：多市场全天候行情监控与手机推送系统（**Quantum Monitor**），主力运行组件为部署在阿里云香港 ECS 的无 UI 独立守护进程 `tools/binance-alert-daemon.ts`（`esbuild` 打包为单文件 `dist-alert/binance-alert-daemon.cjs`），通过自建 `ntfy` 实时推送 90 秒异动告警与每 10 分钟浓缩行情播报。
>
> **安全红线**：严禁在对话回复、日志或公开 Git 提交中泄露任何密钥——包括 Telegram `bot_token` / `chat_id`、私有 `ntfy.topic`、微信 iLink `token.json` / `state.json`、SSH 私钥（`aliyun_remix_ed25519`）、`.env` 及本地私有笔记（`aliyun/总知识库.md`、`aliyun/网络资产.md`）。

---

## 1. 拓扑与入口一览

| 节点 / 位置 | 角色 | 核心路径 / 地址 |
| :--- | :--- | :--- |
| **本地工作区（自包含根目录）** | 代码开发、测试、构建、部署与私密配置备份 | `d:\AI\remix`（所有项目源码、脚本、密钥备份均收拢于此目录内） |
| **GitHub 公开仓库** | 代码与脱敏配置模板同步（`main` 分支） | `https://github.com/liyidao1993/quantum-monitor-alert` |
| **阿里云 ECS 生产机** | 24×7 运行行情监控守护进程与自建推送服务 | `cn-hongkong`（中国香港 C） / 实例 `i-j6cch8046l3vexqajegj` / 公网 IP `47.83.122.79` / 安全组 `sg-j6cch8046l3vexqcydlx` |
| **守护进程服务** | Node.js v20，非 root 专用用户 `quantum` 运行 | `quantum-binance-alert.service`，目录 `/opt/quantum-alert`，内存上限 `384M/512M`（常驻约 `35MB`） |
| **自建手机推送服务** | Go 版 `ntfy v2.38.1`，免翻墙直连 | `ntfy.service`，监听 `http://47.83.122.79:8090`（安全组放行 TCP `8090`），配置 `/etc/ntfy/server.yml` |
| **主机/云管 MCP** | 辅助查服务器状态与阿里云资源 | `shilikongzhitai`（`server_status` / `monitor_status` / `ntfy_health`）与 `yunkongzhitai`（ECS/CMS/OOS） |

*服务器规格与系统优化*：2 vCPU / 1.7 GiB RAM + 1.0 GiB Swap（`/swapfile`）/ 40 GB 磁盘 / Ubuntu 22.04；已停用并屏蔽 `fwupd.service`（释放 ~160 MiB）；`journald` 限制 `200M / 14day`；守护进程禁用本地文件日志（由 `journald` 统一托管）。

---

## 2. 目录结构与核心模块

```text
d:\AI\remix\
├── HANDOVER.md                                 # 本文件（AI 接管主入口）
├── alert-daemon.config.json                    # [忽略/私密] 实际运行配置（Topic/Token/20个自选）
├── alert-daemon.example.json                   # 脱敏配置示例（公开）
├── alert-daemon.schema.json                    # 配置 JSON Schema
├── tools/
│   ├── binance-alert-daemon.ts                 # 守护进程主入口（WS + Watchlist + 广播 + 指令）
│   ├── build-alert-daemon.mjs                  # esbuild 单文件打包脚本 -> dist-alert/binance-alert-daemon.cjs
│   ├── deploy-aliyun-alert.ps1                 # 核心打包脱敏 + SSH/SCP 推送 + systemd 重启脚本
│   └── alert-daemon/
│       ├── config.ts                           # 配置解析与类型定义（含 Stocks_CN、group、alert_enabled）
│       ├── alertRules.ts                       # 90s 瞬时异动规则、MA60 偏离规则、20m 同币种严格冷却
│       ├── watchlist.ts                        # 5 市场自选轮询、东财+Yahoo 回退、盘前毛刺防抖
│       ├── marketStore.ts                      # 行情内存缓存、滑动窗口与 1m/15m/1d MA60 计算
│       ├── ranking.ts                          # 紧凑等宽 10m 播报排版（顶部 4行×3列 A/美股指数对照区）
│       ├── notifiers.ts                        # ntfy / Telegram / 桌面通知发送与告警去重排版
│       ├── weixinNotifier.ts                   # 微信 iLink 指令查询客户端
│       ├── state.ts                            # 运行态原子持久化
│       └── *.test.ts                           # 5 套单元测试
├── Quantum_Monitor_System/
│   ├── 1_Core_Engine/settings.json             # [忽略/私密] 上游接口配置（部署时自动清空本地代理）
│   ├── 2_Market_Modules/
│   │   ├── Crypto_Binance/                     # 币安主网 REST/WS 客户端
│   │   ├── Stocks_CN/api_client/EastMoneyStocksCnHeatApiClient.ts  # 东财 A 股实时点位接口
│   │   ├── Stocks_US/api_client/YahooUsStocksApiClient.ts          # Yahoo 美股/指数接口（直取 chartPreviousClose）
│   │   ├── Futures_Global/                     # Yahoo 外盘期货（含周末休市 regularMarketPrice 回退）
│   │   └── Futures_CN/                         # 新浪国内期货（403 降级 K 线）
│   └── 4_Shared_Types/symbol_mapping/TradingViewSymbolMapper.ts    # 多市场代码映射
├── aliyun/
│   ├── README.md                               # 阿里云详细运维手册
│   ├── deploy-aliyun-alert.ps1                 # 一键构建发布包装脚本（支持 -SkipBuild）
│   ├── check-aliyun-status.ps1                 # 一键查负载/内存/服务/ntfy连接/最近日志
│   ├── alert-daemon.config.example.json        # 阿里云脱敏配置模板
│   ├── settings.example.json                   # 核心接口脱敏模板
│   ├── ntfy-server.yml.example                 # 阿里云 /etc/ntfy/server.yml 参考配置
│   └── local-secrets/                          # [忽略/私密] 本机完整密钥与配置镜像备份
├── .runtime/weixin/                            # [忽略/私密] 微信 iLink token.json / state.json
└── dist-alert/binance-alert-daemon.cjs         # [忽略] 打包产物（与云端线上一致）
```

---

## 3. 当前线上监控规则与推送行为

### 3.1 监控范围
1. **币安纯加密货币永续合约 Top 30**（按 24H 成交额每 4 小时刷新）：
   * 正向白名单过滤：`status=TRADING && contractType=PERPETUAL && underlyingType=COIN && quoteAsset=USDT`，隔离 TradFi 股指/商品合约与稳定币。
   * **90 秒瞬时异动**：阈值 `5%`；每次触发后**立即重置滑动窗口锚点至触发价**，随后立刻监控下一波新波动。
2. **固定自选 Watchlist（共 20 个标的，每 15 秒轮询，全部开启实时异动）**：
   * **A 股三大指数**（`Stocks_CN`，`group: "index_cn"`，`alert_enabled: true`）：`SH000001`（上证）、`SZ399006`（创业）、`SH000688`（科创）；主源东方财富 0 延迟实时接口，失败自动回退 Yahoo（`000001.SS` / `399006.SZ` / `000688.SS`）。
   * **美股三大指数**（`Stocks_US`，`group: "index_us"`，`alert_enabled: true`）：`^GSPC`（标普）、`^IXIC`（纳指）、`^DJI`（道指）。
   * **其余 14 个自选标的**（含全部 6 大指数共 20 个，90 秒异动阈值均为 `1%`）：`BTCUSDT`、`GC1!`（黄金）、`CL1!`（石油）、`NVDA`、`MU`、`QQQ`、`SPY`、`SAMSUNGUSDT`、`NOK`、`SKHY`、`ANT`、`SPCX`、`ZC1!`（美玉米）、`C0`（国内玉米主力）。

### 3.2 实时自由告警（无冷却、无频控、无防抖延迟）与 MA60 策略
* **解除全部时间/次数/防抖限制**：
  * `cooldown.base_seconds: 0`（无冷却时间限制）
  * `cooldown.max_alerts_per_symbol_per_10min: 0`（无 10 分钟次数上限）
  * `instant_move.watchlist_confirm_spike: false`（关闭自选单帧毛刺 2 帧确认等待，首帧达标即刻触发）
  * 每次触发后仍保留**滑动窗口锚点重置为触发价**（防止同一波已报行情原地重复刷屏；只要从新锚点再波动 ≥1%/5% 即刻再次触发）。
* **MA60 偏离**：主动异动报警保持关闭（`ma60_alerts.enabled: false`），后台继续计算 `1m / 15m / 1d` 偏离并展示于每 10 分钟定时播报。

### 3.3 推送通道现状
* **ntfy（当前主力）**：手机 App 免谷歌版开启 WebSockets，连接 `http://47.83.122.79:8090`（Topic 见本地 `alert-daemon.config.json` 的 `ntfy.topic`）。
  * 瞬时异动：`priority=4`（强提醒，精简 2 行去重文案）。
  * 10 分钟定时播报：`priority=2`（静默），手机等宽 ≤36 列不换行；**👀 自选快照**顶部为 4 行 × 3 列浓缩指数对照区（A 股在上、美股居下，整数点位 + 1 位小数涨跌幅），分隔线下紧接 14 个常规自选明细。
* **Telegram**：默认关闭（`telegram.enabled: false`），随时可在配置中重新启用。
* **微信 iLink**：仅开启手动指令回复（`/status` `/top` 等）；关闭被动告警与定时广播（因 `context_token` 约 15 分钟失效）。

---

## 4. 本地密钥位置（均被 `.gitignore` 严格排除）

以下文件仅保留在本地 `d:\AI\remix` 内，绝不提交 GitHub：
* `alert-daemon.config.json`（完整副本：`aliyun\local-secrets\alert-daemon.config.json`）
* `Quantum_Monitor_System\1_Core_Engine\settings.json`（完整副本：`aliyun\local-secrets\settings.json`）
* `.runtime\weixin\token.json` & `state.json`（完整副本：`aliyun\local-secrets\weixin\`）
* SSH 免密私钥：`C:\Users\ligongzi\.ssh\aliyun_remix_ed25519`（完整副本：`aliyun\local-secrets\aliyun_remix_ed25519`，脚本在 `~/.ssh` 缺失时自动回退读取本地副本）
* 本地私有资产记录：`aliyun\总知识库.md`、`aliyun\网络资产.md`

---

## 5. 标准开发、测试与部署流程（在 `d:\AI\remix` 下执行）

> **原则**：所有改动必须**本地修改 → 本地测试编译 → 通过一键脚本发布到阿里云**，严禁直接在云端手改代码或配置。

### 5.1 本地类型检查与全部单元测试
```powershell
npm run lint
npm run test:alert-rules
npm run test:alert-watchlist
npm run test:market-store
npm run test:telegram-rich
npm run test:floating-receiver
```

### 5.2 发布到阿里云与验收
```powershell
# 改了代码（重新打包 + 脱敏配置 + 上传 + 重启 systemd + 打印验收日志）
powershell -ExecutionPolicy Bypass -File .\aliyun\deploy-aliyun-alert.ps1

# 仅改了 alert-daemon.config.json（跳过编译秒传）
powershell -ExecutionPolicy Bypass -File .\aliyun\deploy-aliyun-alert.ps1 -SkipBuild

# 随时检查阿里云内存、服务状态、ntfy 连接数与最新日志
powershell -ExecutionPolicy Bypass -File .\aliyun\check-aliyun-status.ps1
```
*(若修改了 `alert-daemon.config.json`，同步复制到 `aliyun\local-secrets\alert-daemon.config.json`；若变更了通用默认项，同步脱敏更新 `aliyun\alert-daemon.config.example.json`。)*

### 5.3 Git 同步规范
```powershell
# 本机存在 safe.directory 校验，请按命令临时传入 -c，不要修改全局 git config
git -c safe.directory=D:/AI/remix status -s
git -c safe.directory=D:/AI/remix diff --cached --name-only  # 提交前确认无任何私密文件
```

---

## 6. ⚠️ 关键踩坑与红线（修改代码/运维必读）

1. **币安主网 WebSocket 地址切勿改回旧路径**：必须使用 `wss://fstream.binance.com/market/stream`（旧路径 `/stream` 虽能建连但 0 帧无数据；`fstream.binancefuture.com` 缺新币/合约）。
2. **本机 SSH 必须绕过 FlClash TUN**：开启 FlClash TUN 会拦截出站 TCP 22 端口；`deploy-aliyun-alert.ps1` 与 `check-aliyun-status.ps1` 已自动检测本机物理局域网 IPv4 并附加 `-o BindAddress=<LAN_IP>`，手敲 SSH 时同样需绑定。
3. **JSON 必须 UTF-8 无 BOM & 归档用 `.tar.gz`**：PowerShell 默认编码易带 BOM 导致 Node `JSON.parse` 报错，部署脚本统一用 Node 写入无 BOM JSON 并用 `tar -czf` 打包。
4. **防刷屏逻辑红线（`alertRules.ts`）**：
   * `InstantMoveRule.canRaise` 必须按 `tick.symbol` 维度冷却（不能按 `ruleKey`），否则同时出现在 Binance Top 20 和 Watchlist 的标的会双发。
   * 阶梯穿透判断已修复为 `absMove >= threshold + step`（历史 Bug 曾写为 `Math.max(threshold, step)` 导致 `step <= threshold` 时无条件穿透冷却）；当前配置 `same_direction_step_percent: 0` 为严格 20 分钟封顶。
5. **Yahoo Finance 与国内行情接口特性**：
   * 创业板（`399006.SZ`）与科创 50（`000688.SS`）在 Yahoo `1d` K 线接口常返回空数组，需以东方财富实时接口为主源，并保留 Yahoo `1m&range=1d` 直取 `meta.chartPreviousClose` 的逻辑。
   * 美股/外盘期货周末休市无盘中 K 线时回退 `meta.regularMarketPrice`；国内期货（新浪 `hq.sinajs.cn`）遇 403 自动降级走新浪 K 线接口。
6. **手机 `ntfy` 等宽排版宽度限制**：手机端代码块单行超过 `36~38` 半角宽度就会折行破坏对齐，调整 `tools/alert-daemon/ranking.ts` 时需保持 36 列以内（中文按 2 列计）并通过 `npm run test:telegram-rich` 校验。
7. **云端部署配置自动脱敏**：`deploy-aliyun-alert.ps1` 上传前会自动关闭 `desktop_notify`、`logging.file_enabled`、清空 `settings.json` 中的本地代理，并在云端保护现有 `.runtime/weixin/state.json` 不被旧本地文件覆盖。
