import { SystemEvents } from '../../4_Shared_Types/standard_models/eventTypes.js';
import type { MarketModule } from '../../4_Shared_Types/standard_models/moduleTypes.js';
import type { MarketModuleName, ModuleStatus } from '../../4_Shared_Types/standard_models/marketTypes.js';
import type { EventBus } from '../EventBus/EventBus.js';

export class LifecycleController {
  private modules = new Map<MarketModuleName, MarketModule>();
  private statuses = new Map<MarketModuleName, ModuleStatus>();
  private opTokens = new Map<MarketModuleName, number>();

  constructor(private readonly eventBus: EventBus) {}

  register(module: MarketModule): void {
    this.modules.set(module.name, module);
    this.setStatus(module.name, 'sleeping');
  }

  async start(moduleName: MarketModuleName): Promise<void> {
    const module = this.getModule(moduleName);
    const token = this.nextToken(moduleName);
    this.setStatus(moduleName, 'starting');
    try {
      await module.start();
      if (this.opTokens.get(moduleName) !== token) return;
      this.setStatus(moduleName, 'running');
    } catch (err) {
      if (this.opTokens.get(moduleName) !== token) return;
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus(moduleName, 'error', message);
      throw err;
    }
  }

  async stop(moduleName: MarketModuleName): Promise<void> {
    const module = this.getModule(moduleName);
    const token = this.nextToken(moduleName);
    this.setStatus(moduleName, 'stopping');
    try {
      await module.stop();
      if (this.opTokens.get(moduleName) !== token) return;
      this.setStatus(moduleName, 'sleeping');
    } catch (err) {
      if (this.opTokens.get(moduleName) !== token) return;
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus(moduleName, 'error', message);
      throw err;
    }
  }

  async destroy(moduleName: MarketModuleName): Promise<void> {
    const module = this.getModule(moduleName);
    const token = this.nextToken(moduleName);
    this.setStatus(moduleName, 'stopping');
    try {
      await module.destroy();
      if (this.opTokens.get(moduleName) !== token) return;
      this.setStatus(moduleName, 'destroyed');
    } catch (err) {
      if (this.opTokens.get(moduleName) !== token) return;
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus(moduleName, 'error', message);
      throw err;
    }
  }

  getStatus(moduleName: MarketModuleName): ModuleStatus {
    return this.statuses.get(moduleName) ?? 'sleeping';
  }

  getAllStatuses(): Array<{ market: MarketModuleName; status: ModuleStatus }> {
    return Array.from(this.statuses.entries()).map(([market, status]) => ({ market, status }));
  }

  getRegisteredModuleNames(): MarketModuleName[] {
    return Array.from(this.modules.keys());
  }

  private getModule(moduleName: MarketModuleName): MarketModule {
    const module = this.modules.get(moduleName);
    if (!module) {
      throw new Error(`Market module is not registered: ${moduleName}`);
    }
    return module;
  }

  private setStatus(moduleName: MarketModuleName, status: ModuleStatus, reason?: string): void {
    this.statuses.set(moduleName, status);
    this.eventBus.publish(SystemEvents.ModuleStatusChanged, {
      market: moduleName,
      status,
      reason,
      updated_at: new Date().toISOString(),
    });
  }

  private nextToken(moduleName: MarketModuleName): number {
    const token = (this.opTokens.get(moduleName) ?? 0) + 1;
    this.opTokens.set(moduleName, token);
    return token;
  }
}
