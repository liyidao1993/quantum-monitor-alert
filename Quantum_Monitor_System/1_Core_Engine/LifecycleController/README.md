# LifecycleController

负责市场模块生命周期：

- 启动
- 暂停
- 恢复
- 销毁

销毁模块时必须完成：

- 断开网络请求
- 清空定时器
- 注销事件监听
- 释放模块内部状态

实现文件：

- `LifecycleController.ts`

