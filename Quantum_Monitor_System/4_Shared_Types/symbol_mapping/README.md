# Symbol Mapping

纯函数符号映射层。

职责：

- 把用户输入转换为后端数据源符号
- 把用户输入转换为 TradingView 图表符号
- 保持币安合约、国内期货、外盘期货的代码边界清晰

该目录不能做网络请求，不能依赖 UI，也不能保存运行状态。

## 示例

| 输入 | 市场 | 后端数据源 | TradingView |
|------|------|------------|-------------|
| `BTC/USDT` | `Crypto_Binance` | `BTCUSDT` | `BINANCE:BTCUSDT.P` |
| `GC1!` | `Futures_Global` | `GC=F` | `COMEX:GC1!` |
| `GC=F` | `Futures_Global` | `GC=F` | `COMEX:GC1!` |
| `RB2501` | `Futures_CN` | `RB2501` | `SHFE:RB2501` |
| `C0` | `Futures_CN` | `C0` | `DCE:C0` |
