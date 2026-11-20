# AlertEngine

独立预警引擎。

职责：
- 订阅 EventBus 上的标准行情 tick。
- 基于已有 tick 做价格异动窗口监控，不额外请求价格或 K 线。
- 通过 `SystemEvents.AlertRaised` 发布标准预警事件。
- 处理冷却时间，避免同一品种同一类型刷屏。
- 按配置发送 Telegram 通知。

当前价格异动规则：
- 每个 `market:symbol` 维护一个内存价格窗口。
- 窗口长度由 `instant_window_seconds` 控制。
- 在窗口内寻找低点和高点。
- 当前价相对窗口低点上涨超过 `instant_move_percent`，触发上涨异动。
- 当前价相对窗口高点下跌超过 `instant_move_percent`，触发下跌异动。

市场模块只负责发布标准行情，不直接发送预警。
