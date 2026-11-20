import { ConfigManager } from './ConfigManager/ConfigManager.js';
import { eventBus } from './EventBus/EventBus.js';
import { LifecycleController } from './LifecycleController/LifecycleController.js';
import { BinanceMonitorModule } from '../2_Market_Modules/Crypto_Binance/module_entry/BinanceMonitorModule.js';
import { BinanceApiClient } from '../2_Market_Modules/Crypto_Binance/api_client/BinanceApiClient.js';
import { SystemEvents } from '../4_Shared_Types/standard_models/eventTypes.js';

const configManager = new ConfigManager();
const lifecycle = new LifecycleController(eventBus);
const binanceModule = new BinanceMonitorModule(eventBus, configManager, new BinanceApiClient());

lifecycle.register(binanceModule);

const unsubscribeStatus = eventBus.subscribe(SystemEvents.ModuleStatusChanged, payload => {
  console.log(`[status] ${payload.market}: ${payload.status}`);
});

const unsubscribeBinance = eventBus.subscribe(SystemEvents.BinanceDataUpdated, payload => {
  console.log(
    `[tick] ${payload.symbol} price=${payload.price} 24h=${payload.change_24h}% ma1=${payload.ma60_dev_1m}% ma15=${payload.ma60_dev_15m}% day=${payload.ma60_dev_1d}%`,
  );
});

await lifecycle.start('Crypto_Binance');

setTimeout(async () => {
  await lifecycle.destroy('Crypto_Binance');
  unsubscribeStatus();
  unsubscribeBinance();
  eventBus.clear();
  console.log('[demo] Core engine demo finished. UI was not required.');
}, 5_000);

