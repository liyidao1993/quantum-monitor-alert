# Quantum Monitor System

全市场监控系统后台主目录。

项目以 EventBus 为中心，后台市场模块发布标准行情 tick，UI、SSE 和预警系统只消费标准事件，不直接耦合某个市场模块的内部实现。

## 目录约定

- `0_Docs`: 开发文档、布局蓝图、进度记录和事实来源。
- `1_Core_Engine`: 中立核心引擎，包括 EventBus、配置管理、生命周期控制和预警引擎。
- `2_Market_Modules`: 独立市场模块，每个模块有自己的启动和销毁入口。
- `4_Shared_Types`: 前后端共享的数据契约。

## 当前预警口径

- `AlertEngine` 订阅 `SystemEvents.MarketDataUpdated`。
- 预警只按已有 tick 做价格异动窗口判断，不额外请求价格或 K 线。
- MA60 偏离只作为行情页和首页的展示/排序指标，不触发预警。
- 国内股票热度模块会额外按热榜个股和板块短时变化发布 `instant_move` 类型预警，同样不使用 MA60。

## 行情口径

- 币安合约通过 WebSocket 获取价格，并按 `price_seconds` 节流发布 tick。
- 国内期货、外盘期货、美股主要按配置轮询报价/K 线，发布统一 `StandardMarketTick`。
- 各模块可继续计算 `ma60_dev_1m`、`ma60_dev_15m`、`ma60_dev_1d`，但这些字段不参与预警触发。
