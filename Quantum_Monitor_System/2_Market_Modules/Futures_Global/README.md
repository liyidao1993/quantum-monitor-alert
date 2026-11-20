# Futures_Global

外盘期货模块。

## 目标

- 外盘期货 UI 与后台逻辑独立于币安合约和国内期货
- 支持 Yahoo 符号和 TradingView 符号双映射
- 输出统一 `StandardMarketTick`

## 参考数据源

从 `remix参考` 项目确认的可参考 SDK：

```ts
yahoo-finance2.chart(symbol, {
  period1,
  interval: "1m" | "15m",
})
```

参考符号：

- `GC=F` / `COMEX:GC1!`
- `CL=F` / `NYMEX:CL1!`
- `NQ=F` / `CME:NQ1!`
- `ES=F` / `CME:ES1!`
- `ZC=F` / `CBOT:ZC1!`

## 实施要求

- Yahoo 分钟线受限流和休市影响，必须保留旧值并标记数据质量
- TradingView Widget 只负责图表显示，不能被当作后端计算数据源
- 后端取数符号和前端图表符号必须由 mapper 统一管理

## 当前实现

- 已新增 `api_client/IFuturesGlobalApiClient.ts`
- 已新增 `api_client/YahooFuturesApiClient.ts`
- 已新增 `npm run verify:yahoo` 用于验证 `GC1!`、`NQ=F` 的 1m / 15m 分钟线

下一步再接入模块生命周期和 EventBus。
