# Standard Models

标准化行情事件模型。

币安数据事件初始契约：

```json
{
  "market": "Crypto_Binance",
  "symbol": "BTC/USDT",
  "price": 65000.5,
  "change_24h": 2.5,
  "ma60_dev_1m": 0.05,
  "ma60_dev_15m": 1.2,
  "ma60_dev_1d": 5.6
}
```

首批 TypeScript 契约：

- `marketTypes.ts`: 市场名称、配置结构、标准行情包。
- `eventTypes.ts`: EventBus 事件名与 payload 映射。
- `moduleTypes.ts`: 市场模块生命周期接口。
