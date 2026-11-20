# Crypto_Binance

币安合约监控模块。

职责：

- 获取成交量 Top N 合约。
- 拉取最近 60 根 K 线并计算 MA60 快照。
- 通过 WebSocket 接收实时价格。
- 计算 MA60 偏离值并通过 EventBus 发布。

