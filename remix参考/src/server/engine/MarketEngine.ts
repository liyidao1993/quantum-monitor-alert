import { EventEmitter } from 'events';
import { BinanceService } from '../services/BinanceService.js';
import { YahooFinanceService } from '../services/YahooFinanceService.js';
import { SinaFinanceService } from '../services/SinaFinanceService.js';

export interface MarketState {
  symbol: string;
  market: 'binance' | 'tradingview' | 'sina';
  price: number;
  ma60_1m: number;
  dev_1m: number;
  ma60_15m: number;
  dev_15m: number;
}

export interface Config {
  refreshIntervalSeconds: number;
  anomalyThresholdPercent: number;
  anomalyTimeframeSeconds: number;
  cryptoMa1mAlertThreshold: number;
  cryptoMa15mAlertThreshold: number;
  futuresMa1mAlertThreshold: number;
  futuresMa15mAlertThreshold: number;
  enableCrypto: boolean;
  enableFutures: boolean;
  tvCustomSymbols: string[];
}

export class MarketEngine extends EventEmitter {
  private binance: BinanceService;
  private yahoo: YahooFinanceService;
  private sina: SinaFinanceService;
  private cryptoSymbols: string[] = [];
  
  public state: Map<string, MarketState> = new Map();

  // Price history for anomaly detection (sliding window)
  private priceWindow: Map<string, { t: number, p: number }[]> = new Map();
  // Cooldown tracker for alerts (symbol_type -> timestamp)
  private lastAlertTimes: Map<string, number> = new Map();
  
  private cycleTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isProcessing = false;

  public config: Config = {
    refreshIntervalSeconds: 15,
    anomalyThresholdPercent: 2.0,
    anomalyTimeframeSeconds: 30,
    cryptoMa1mAlertThreshold: 5.0,
    cryptoMa15mAlertThreshold: 10.0,
    futuresMa1mAlertThreshold: 0.5, // Futures typically have smaller movements
    futuresMa15mAlertThreshold: 1.0,
    enableCrypto: true,
    enableFutures: true,
    tvCustomSymbols: ['ES=F', 'NQ=F', 'GC=F', 'CL=F', 'ZC=F', 'C0'] // default S&P500, Nasdaq, Gold, Crude Oil, US Corn, Chinese Corn
  };

  constructor() {
    super();
    this.binance = new BinanceService();
    this.yahoo = new YahooFinanceService();
    this.sina = new SinaFinanceService();
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("Starting Market Engine (Polling Mode)...");
    this.runCycle();
  }

  private async runCycle() {
    if (!this.isRunning || this.isProcessing) return;
    this.isProcessing = true;
    const startTime = Date.now();
    
    try {
      if (this.config.enableCrypto) {
          this.cryptoSymbols = await this.binance.getTop50SymbolsByVolume();
          
          const batchSize = 10;
          for (let i = 0; i < this.cryptoSymbols.length; i += batchSize) {
            const batch = this.cryptoSymbols.slice(i, i + batchSize);
            await Promise.all(batch.map(async (sym) => {
              const m1 = await this.binance.getKlines(sym, '1m', 60);
              const m15 = await this.binance.getKlines(sym, '15m', 60);
              
              if (m1.length === 0 || m15.length === 0) return;

              const price = m1[m1.length - 1]; // Current close price
              const ma60_1m = m1.reduce((a, b) => a + b, 0) / m1.length;
              const ma60_15m = m15.reduce((a, b) => a + b, 0) / m15.length;
              
              const dev_1m = ((price - ma60_1m) / ma60_1m) * 100;
              const dev_15m = ((price - ma60_15m) / ma60_15m) * 100;

              const s_sym = sym.toUpperCase();
              this.state.set(sym, {
                symbol: s_sym,
                market: 'binance',
                price,
                ma60_1m,
                dev_1m,
                ma60_15m,
                dev_15m
              });

              this.trackAnomaly(sym, price, startTime);

              const checkAlert = (type: string, dev: number, threshold: number, timeStr: string) => {
                  if (Math.abs(dev) >= threshold) {
                      const alertKey = `${s_sym}_${type}`;
                      const lastAlert = this.lastAlertTimes.get(alertKey) || 0;
                      if (startTime - lastAlert > 5 * 60 * 1000) { // 5 minutes cooldown
                          const direction = dev > 0 ? '超买' : '超卖';
                          this.emit('alert', { type, symbol: s_sym, message: `${s_sym} ${timeStr}均线偏离过大状态: ${direction} (${dev.toFixed(2)}%)`, timestamp: startTime });
                          this.lastAlertTimes.set(alertKey, startTime);
                      }
                  }
              };

              checkAlert('ma1', dev_1m, this.config.cryptoMa1mAlertThreshold, '1m');
              checkAlert('ma15', dev_15m, this.config.cryptoMa15mAlertThreshold, '15m');
            }));
            
            await new Promise(r => setTimeout(r, 200));
          }
      } else {
        // Clear crypto symbols if disabled
        for (const [key, val] of this.state.entries()) {
            if (val.market === 'binance') this.state.delete(key);
        }
      }

      if (this.config.enableFutures && this.config.tvCustomSymbols.length > 0) {
         // Process TradingView/Yahoo/Sina futures
         for (const sym of this.config.tvCustomSymbols) {
            let m1: number[] = [];
            let m15: number[] = [];
            let marketType: MarketState['market'] = 'tradingview';
            
            // Normalize symbol for fetching
            const trimmedSym = sym.trim();
            if (!trimmedSym) continue;

            let fetchSym = trimmedSym.toUpperCase();
            if (fetchSym.endsWith('1!')) {
               fetchSym = fetchSym.replace('1!', '=F');
            }

            if (fetchSym.includes('=') || fetchSym.includes('^')) {
               m1 = await this.yahoo.getKlines(fetchSym, '1m', 60);
               m15 = await this.yahoo.getKlines(fetchSym, '15m', 60);
            } else {
               // Try Sina (domestic) - Normalize to uppercase for Sina futures
               const sinaSym = trimmedSym.toUpperCase();
               m1 = await this.sina.getKlines(sinaSym, '1m', 60);
               m15 = await this.sina.getKlines(sinaSym, '15m', 60);
               marketType = 'sina';
            }
            
            if (m1.length > 0 && m15.length > 0) {
                const price = m1[m1.length - 1];
                const ma60_1m = m1.reduce((a, b) => a + b, 0) / m1.length;
                const ma60_15m = m15.reduce((a, b) => a + b, 0) / m15.length;
                
                const dev_1m = ((price - ma60_1m) / ma60_1m) * 100;
                const dev_15m = ((price - ma60_15m) / ma60_15m) * 100;

                const s_sym = trimmedSym.toUpperCase();
                this.state.set(trimmedSym, {
                    symbol: s_sym,
                    market: marketType,
                    price,
                    ma60_1m,
                    dev_1m,
                    ma60_15m,
                    dev_15m
                });

                this.trackAnomaly(trimmedSym, price, startTime);

                const checkAlert = (type: string, dev: number, threshold: number, timeStr: string) => {
                  if (Math.abs(dev) >= threshold) {
                      const alertKey = `${s_sym}_${type}`;
                      const lastAlert = this.lastAlertTimes.get(alertKey) || 0;
                      if (startTime - lastAlert > 5 * 60 * 1000) { // 5 minutes cooldown
                          const direction = dev > 0 ? '超买' : '超卖';
                          this.emit('alert', { type, symbol: s_sym, message: `${s_sym} ${timeStr}均线偏离过大状态: ${direction} (${dev.toFixed(2)}%)`, timestamp: startTime });
                          this.lastAlertTimes.set(alertKey, startTime);
                      }
                  }
                };

                checkAlert('ma1', dev_1m, this.config.futuresMa1mAlertThreshold, '1m');
                checkAlert('ma15', dev_15m, this.config.futuresMa15mAlertThreshold, '15m');
            }
            await new Promise(r => setTimeout(r, 500)); // Be gentle with rate limits
         }
      } else {
          for (const [key, val] of this.state.entries()) {
              if (val.market === 'tradingview' || val.market === 'sina') this.state.delete(key);
          }
      }

      const stateArray = Array.from(this.state.values());
      stateArray.sort((a, b) => Math.abs(b.dev_1m) - Math.abs(a.dev_1m));
      this.emit('state_update', stateArray);
      
    } catch (error) {
       console.error("Error in polling cycle", error);
    }

    const elapsed = Date.now() - startTime;
    const delay = Math.max(1000, (this.config.refreshIntervalSeconds * 1000) - elapsed);
    
    this.isProcessing = false;
    this.cycleTimer = setTimeout(() => this.runCycle(), delay);
  }

  private trackAnomaly(sym: string, currentPrice: number, now: number) {
    let window = this.priceWindow.get(sym);
    if (!window) {
      window = [];
      this.priceWindow.set(sym, window);
    }
    
    window.push({ t: now, p: currentPrice });
    
    // Clean up old entries based on configured timeframe
    while (window.length > 0 && now - window[0].t > this.config.anomalyTimeframeSeconds * 1000) {
      window.shift();
    }

    if (window.length > 0) {
      const oldestPrice = window[0].p;
      const diff = (currentPrice - oldestPrice) / oldestPrice * 100;
      
      if (Math.abs(diff) >= this.config.anomalyThresholdPercent) {
        const direction = diff > 0 ? '拉升(Surge)' : '暴跌(Drop)';
        const msg = `${sym} 发生异常波动: ${direction} ${Math.abs(diff).toFixed(2)}% (耗时约 ${Math.round((now - window[0].t)/1000)}秒)`;
        this.emit('alert', { type: 'anomaly', symbol: sym, message: msg, timestamp: now });
        
        // Prevent immediate spamming by resetting the sliding window for this pair
        this.priceWindow.set(sym, []);
      }
    }
  }

  public updateConfig(newConfig: Partial<Config>) {
      this.config = { ...this.config, ...newConfig };
      
      if (newConfig.refreshIntervalSeconds && this.cycleTimer) {
         clearTimeout(this.cycleTimer);
         this.runCycle();
      }
  }
}

