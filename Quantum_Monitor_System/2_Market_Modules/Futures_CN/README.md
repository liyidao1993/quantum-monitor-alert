# Futures_CN

国内期货模块。

## 目标

- 国内期货 UI 与后台逻辑独立于币安合约和外盘期货
- 支持自选列表、主力合约、交易所前缀映射
- 输出统一 `StandardMarketTick`

## 参考数据源

从 `remix参考` 项目确认的可参考接口：

```text
https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var/InnerFuturesNewService.getFewMinLine?symbol={symbol}&type=1
https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var/InnerFuturesNewService.getFewMinLine?symbol={symbol}&type=15
```

调试报价接口：

```text
https://hq.sinajs.cn/list={symbol}
```

## 实施要求

- 接入前必须做超时、错误保留旧值、数据质量检查
- 后端取数符号和 TradingView 图表符号必须通过 mapper 转换
- 不允许直接在 React 组件里散落交易所映射逻辑

## 当前实现

- 已新增 `api_client/IFuturesCnApiClient.ts`
- 已新增 `api_client/SinaFuturesApiClient.ts`
- 已新增 `npm run verify:sina` 用于验证 `C0`、`RB2501` 的 1m / 15m 分钟线

下一步再接入模块生命周期和 EventBus。
