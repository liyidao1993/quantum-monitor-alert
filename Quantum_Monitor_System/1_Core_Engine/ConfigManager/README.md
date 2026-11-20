# ConfigManager

负责读写 `1_Core_Engine/settings.json`。

约束：

- 所有用户配置必须从这里统一进入。
- 业务模块不得绕过 ConfigManager 直接维护独立配置文件。
- 写入配置前需要校验共享类型契约。

实现文件：

- `ConfigManager.ts`

