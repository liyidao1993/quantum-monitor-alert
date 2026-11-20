# Market Modules

每个市场模块都是独立沙箱。

模块只能依赖：

- `1_Core_Engine/EventBus`
- `1_Core_Engine/ConfigManager`
- `4_Shared_Types`

模块不得直接依赖 UI。

## 当前拆分方向

- `Crypto_Binance`: 币安 USD-M Futures，成交额 Top 50，轻量 MA60，实时价格优先走 WebSocket
- `Futures_CN`: 国内期货，参考 Sina Futures 分钟线，后续可增加备用源
- `Futures_Global`: 外盘期货，参考 Yahoo Finance 分钟线，图表使用 TradingView Widget

期货模块的后端取数符号和 TradingView 图表符号必须分开维护，不能在 UI 组件里散落硬编码。
