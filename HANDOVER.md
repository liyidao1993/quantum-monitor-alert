# Quantum Monitor 交接文档（AI 一眼接管手册）

> **一句话定位**：多市场 24×7 无 UI 行情异动监控与手机推送守护进程（TypeScript → `esbuild` 单文件 `dist-alert/binance-alert-daemon.cjs`），运行在**阿里云香港 ECS**，通过自建 **`ntfy`** 推送实时异动与每 10 分钟浓缩播报。
>
> **安全红线**：严禁在回复、日志或公开 Git 提交中泄露任何私密内容（`alert-daemon.config.json`、`settings.json`、`ntfy.topic`、Telegram `bot_token`/`chat_id`、微信 `.runtime/weixin/*`、SSH 私钥 `aliyun_remix_ed25519`、`.env`、`aliyun/总知识库.md`、`aliyun/网络资产.md`）。

---

## 0. 十秒速览（AI 接手先看这张表）

| 维度 | 当前线上真实状态 |
| :--- | :--- |
| **本地目录 / GitHub** | `d:\AI\remix`（极简自包含，仅 0.81 MB 源码配置） / `https://github.com/liyidao1993/quantum-monitor-alert` (`main`) |
| **阿里云生产机** | 香港 C `i-j6cch8046l3vexqajegj` / IP `47.83.122.79` / 安全组 `sg-j6cch8046l3vexqcydlx` / 2C 1.7G + 1G Swap |
| **线上服务** | `quantum-binance-alert.service`（用户 `quantum`，`/opt/quantum-alert`，限额 384M/512M）+ `ntfy.service`（`:8090`） |
| **辅助 MCP** | `shilikongzhitai`（查服务/ntfy/币价）、`yunkongzhitai`（阿里云 ECS/CMS/OOS） |
| **币安监控** | **纯加密永续 Top 30**（每 4h 按成交额刷新，隔离 TradFi） / **90 秒 `5%`** 异动告警 |
| **自选监控** | **共 20 标的**（每 15s 轮询）：A 股 3 大指数 + 美股 3 大指数 + 14 个股票/期货/BTC，**全部开启 90 秒 `1%` 异动告警** |
| **防刷屏 / 限制** | **全解除自由模式**：`base_seconds: 0`（无冷却）、`max_alerts_per_symbol_per_10min: 0`（无次数上限）、`watchlist_confirm_spike: false`（首帧即报）；仅保留**触发后窗口锚点重置**防横盘原地刷屏 |
| **MA60 策略** | 主动偏离告警关闭（`ma60_alerts.enabled: false`）；后台持续算 `1m / 15m / 1d` 并随 10 分钟定时播报展示 |
| **推送通道** | **ntfy 主力**（告警 `priority=4` 强响铃，10 分钟播报 `priority=2` 静默）；Telegram 关闭；微信 iLink 仅手动指令查询 |
| **修改发版铁律** | **本地改 → 本地跑 `lint` + 5 套测试 → 一键脚本发阿里云 → 查日志验收**（禁止在云端直接手改） |

---

## 1. 改需求速查表（要改什么 → 直接找哪个文件）

| 任务需求 | 直接查看 / 修改的文件 |
| :--- | :--- |
| 增删自选品种 / 改阈值 / 改冷却 / 改 TopN / 开关通道 | `alert-daemon.config.json`（改完同步复制到 `aliyun/local-secrets/alert-daemon.config.json`；通用默认值同步到 `aliyun/alert-daemon.config.example.json`） |
| 改异动判定、冷却、次数上限、自选毛刺防抖逻辑 | `tools/alert-daemon/alertRules.ts` + `tools/alert-daemon/alertRules.test.ts` |
| 改配置字段、默认值、合法范围校验 | `tools/alert-daemon/config.ts` + `alert-daemon.schema.json` |
| 改自选轮询、A 股东财 / Yahoo / 新浪回退逻辑 | `tools/alert-daemon/watchlist.ts` + `tools/alert-daemon/watchlist.test.ts` |
| 改 10 分钟定时播报排版（含顶部 4 行 × 3 列 A/美股指数对照区） | `tools/alert-daemon/ranking.ts` + `tools/alert-daemon/telegramRich.test.ts` |
| 改 `ntfy` 告警文案、Telegram/桌面推送格式 | `tools/alert-daemon/notifiers.ts` |
| 改主循环、启动日志、指令 `/status` `/top` `/symbol` `/config` | `tools/binance-alert-daemon.ts` |
| 改各市场上游行情 API 客户端 | `Quantum_Monitor_System/2_Market_Modules/*/api_client/`（币安 / 东财 / Yahoo / 新浪） |
| 改打包或阿里云部署流程 | `tools/build-alert-daemon.mjs` / `tools/deploy-aliyun-alert.ps1` / `aliyun/deploy-aliyun-alert.ps1` |

---

## 2. 常用命令（全部在 `d:\AI\remix` 下执行）

### 本地验证（改代码后必跑）
```powershell
npm run lint
npm run test:alert-rules
npm run test:alert-watchlist
npm run test:market-store
npm run test:telegram-rich
npm run test:floating-receiver
```

### 一键部署与线上验收
```powershell
# 改了代码：编译单文件 + 自动脱敏配置 + 上传 + 重启 systemd + 输出启动日志
powershell -ExecutionPolicy Bypass -File .\aliyun\deploy-aliyun-alert.ps1

# 只改了 alert-daemon.config.json：跳过编译秒传
powershell -ExecutionPolicy Bypass -File .\aliyun\deploy-aliyun-alert.ps1 -SkipBuild

# 巡检阿里云负载、内存、双服务状态、ntfy 连接与最新日志
powershell -ExecutionPolicy Bypass -File .\aliyun\check-aliyun-status.ps1
```

### Git 同步（切勿修改全局 `safe.directory`）
```powershell
git -c safe.directory=D:/AI/remix status -s
git -c safe.directory=D:/AI/remix diff --cached --name-only  # 确认 0 私密文件后再 commit/push
```

---

## 3. 当前 20 个自选标的清单

| 类别 | 标的（括号内为展示名） | 数据源 | 实时异动 |
| :--- | :--- | :--- | :--- |
| **A 股指数** (`index_cn`) | `SH000001`(上证)、`SZ399006`(创业)、`SH000688`(科创) | 东方财富主源 → Yahoo 自动回退 | 开启（90s `1%`） |
| **美股指数** (`index_us`) | `^GSPC`(标普)、`^IXIC`(纳指)、`^DJI`(道指) | Yahoo `range=1d`（直取 `chartPreviousClose`） | 开启（90s `1%`） |
| **加密 / 24H** | `BTCUSDT`(比特币)、`SAMSUNGUSDT`(三星电子) | 币安主网 REST | 开启（90s `1%`） |
| **外盘期货** | `GC1!`(黄金)、`CL1!`(石油)、`ZC1!`(美玉米) | Yahoo Futures（周末休市回退 `regularMarketPrice`） | 开启（90s `1%`） |
| **国内期货** | `C0`(国内玉米主力) | 新浪期货（遇 403 自动降级走 K 线接口） | 开启（90s `1%`） |
| **美股个股 / ETF** | `NVDA`、`MU`、`QQQ`、`SPY`、`NOK`、`SKHY`、`ANT`、`SPCX` | Yahoo US Stocks | 开启（90s `1%`） |

---

## 4. 本地私密文件位置（均已 `.gitignore`，绝不上传 GitHub）

- 运行配置：`alert-daemon.config.json`（镜像备份：`aliyun\local-secrets\alert-daemon.config.json`）
- 接口配置：`Quantum_Monitor_System\1_Core_Engine\settings.json`（镜像备份：`aliyun\local-secrets\settings.json`）
- 微信凭证：`.runtime\weixin\token.json` & `state.json`（镜像备份：`aliyun\local-secrets\weixin\`）
- SSH 私钥：`C:\Users\ligongzi\.ssh\aliyun_remix_ed25519`（镜像备份：`aliyun\local-secrets\aliyun_remix_ed25519`，脚本在 `~/.ssh` 缺失时自动回退本地备份）
- 资产备忘：`aliyun\总知识库.md`、`aliyun\网络资产.md`

---

## 5. ⚠️ 踩坑红线（改代码 / 排障前必看）

1. **币安主网 WebSocket 地址不可改错**：必须为 `wss://fstream.binance.com/market/stream`（旧路径 `/stream` 建连后 0 帧无数据；`fstream.binancefuture.com` 缺币）。
2. **本机 SSH 必须绕过 FlClash TUN**：FlClash TUN 会拦截出站 22 端口；部署与巡检脚本已自动检测物理局域网 IP 并加 `-o BindAddress=<LAN_IP>`，手动 SSH 时务必同理。
3. **JSON 无 BOM & `.tar.gz` 打包**：PowerShell 默认写入易带 BOM 导致 Node 解析失败，修改 JSON 优先用 Node 写入 UTF-8 无 BOM；上传包统一用 `tar -czf`。
4. **解除限制相关代码约定（`config.ts` / `alertRules.ts`）**：
   - `cooldown.base_seconds === 0` 表示**真正 0 秒无冷却**（只有省略或 `< 0` 时才回退 `settings.json`）；
   - `cooldown.max_alerts_per_symbol_per_10min === 0` 表示**无 10 分钟次数上限**；
   - `instant_move.watchlist_confirm_spike === false` 表示关闭自选 2 帧防抖等待（首帧即报）；若后续美股盘前再遇 Yahoo 单帧毛刺，改回 `true` 即可；
   - 如重新启用冷却，`InstantMoveRule.canRaise` 按 `tick.symbol` 维度计数，阶梯穿透条件为 `absMove >= threshold + step`。
5. **Yahoo / 东财 / 新浪接口特性**：创业板（`399006.SZ`）与科创（`000688.SS`）在 Yahoo `1d` 接口常返回空数组，须以东财为主源并保留 `meta.chartPreviousClose` 昨收逻辑。
6. **手机 `ntfy` 排版宽度限制**：代码块单行超过 `36~38` 半角宽度会在手机端折行破坏对齐，改 `ranking.ts` 后务必跑 `npm run test:telegram-rich`。
7. **云端部署自动脱敏**：`deploy-aliyun-alert.ps1` 自动关闭云端桌面通知与本地文件日志、清空本地代理，并保护云端现有 `.runtime/weixin/state.json` 不被旧本地文件覆盖。
