import type { MarketModuleName } from './marketTypes.js';

export interface MarketModule {
  readonly name: MarketModuleName;
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
}

