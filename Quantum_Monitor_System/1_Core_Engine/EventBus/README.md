# EventBus

全局事件路由器，负责发布和订阅事件。

约束：

- 后台市场模块只能发布标准化事件。
- UI 只能订阅事件并更新展示状态。
- UI 不得直接调用市场模块。
- 市场模块之间不得互相直接调用。

首批事件：

- `BINANCE_DATA_UPDATED`
- `MODULE_STATUS_CHANGED`
- `DESTROY_CN_STOCKS`
- `SETTINGS_UPDATED`
- `TRADING_VIEW_WINDOW_OPEN_REQUESTED`
- `TRADING_VIEW_WINDOW_CLOSED`

实现文件：

- `EventBus.ts`

