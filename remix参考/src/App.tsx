import { useState, useEffect, useRef } from 'react';
import { Settings, Activity, AlertTriangle, ArrowUpRight, ArrowDownRight, RefreshCcw } from 'lucide-react';
import { cn } from './lib/utils';

const symbolNameMap: Record<string, string> = {
  'ES=F': '标普500', 
  'ES1!': '标普500',
  'NQ=F': '纳斯达克', 
  'NQ1!': '纳斯达克',
  'GC=F': '黄金', 
  'GC1!': '黄金',
  'CL=F': '原油', 
  'CL1!': '原油',
  'ZC=F': '美玉米', 
  'ZC1!': '美玉米',
  'C0': '中国玉米(主力)',
  'C2601': '玉米2601',
  'C2607': '玉米2607',
  'BTCUSDT': '比特币',
  'ETHUSDT': '以太坊',
  'SOLUSDT': 'SOL',
  'DOGEUSDT': '狗狗币',
};

interface MarketState {
  symbol: string;
  market: 'binance' | 'tradingview' | 'sina';
  price: number;
  ma60_1m: number;
  dev_1m: number;
  ma60_15m: number;
  dev_15m: number;
}

interface Alert {
  type: string;
  symbol: string;
  message: string;
  timestamp: number;
}

interface Config {
  refreshIntervalSeconds: number;
  anomalyThresholdPercent: number;
  anomalyTimeframeSeconds: number;
  ma1mAlertThreshold: number;
  ma15mAlertThreshold: number;
  enableCrypto: boolean;
  enableFutures: boolean;
  tvCustomSymbols: string[];
}

function ChartModal({ symbol, onClose }: { symbol: string, onClose: () => void }) {
  const [timeframe, setTimeframe] = useState<'1' | '15'>('1');
  const containerId = 'tv_chart_container_' + symbol;

  useEffect(() => {
    const renderChart = () => {
      // @ts-ignore
      if (window.TradingView) {
        // @ts-ignore
        new window.TradingView.widget({
          autosize: true,
          symbol: (() => {
            const s = symbol.toUpperCase();
            if (s.endsWith('USDT')) {
              return `BINANCE:${s}${s.endsWith('.P') ? '' : '.P'}`;
            }
            // Handle Yahoo format
            if (s.endsWith('=F')) {
              const base = s.replace('=F', '1!');
              if (['GC1!', 'SI1!', 'HG1!'].includes(base)) return `COMEX:${base}`;
              if (['CL1!', 'NG1!', 'RB1!'].includes(base)) return `NYMEX:${base}`;
              if (['NQ1!', 'ES1!', 'YM1!', 'RTY1!'].includes(base)) return `CME:${base}`;
              if (['ZC1!', 'ZW1!', 'ZS1!'].includes(base)) return `CBOT:${base}`;
              return base;
            }
            // Handle TV format (e.g. GC1!)
            if (s.endsWith('1!')) {
              if (['GC1!', 'SI1!', 'HG1!'].includes(s)) return `COMEX:${s}`;
              if (['CL1!', 'NG1!', 'RB1!'].includes(s)) return `NYMEX:${s}`;
              if (['NQ1!', 'ES1!', 'YM1!', 'RTY1!'].includes(s)) return `CME:${s}`;
              if (['ZC1!', 'ZW1!', 'ZS1!'].includes(s)) return `CBOT:${s}`;
              return s;
            }
            // Domestic Sina (e.g. RB2501, C2607)
            if (s.match(/^[A-Z]{1,2}[0-9]{3,4}$/)) {
               // Precision prefix matching
               if (/^(RB|HC|CU|AL|ZN|NI|SN|AU|AG)/.test(s)) return `SHFE:${s}`;
               if (/^(I|J|JM|P|Y|M|C|L|V|PP|EB|PG)/.test(s)) return `DCE:${s}`; 
               if (/^(TA|MA|FG|SF|SM|SA|UR|PF|AP|CJ)/.test(s)) return `ZCE:${s}`;
               if (/^(IF|IH|IC|IM|T|TF|TS)/.test(s)) return `CFFEX:${s}`;
            }
            return s;
          })(),
          interval: timeframe,
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "zh_CN",
          enable_publishing: false,
          hide_top_toolbar: true,
          hide_legend: false,
          save_image: false,
          container_id: containerId,
          studies: [
            {
               id: "MASimple@tv-basicstudies",
               inputs: { length: 60 }
            }
          ]
        });
      }
    };
    
    // @ts-ignore
    if (window.TradingView) {
       renderChart();
    } else {
       let tvScript = document.getElementById("tradingview-script") as HTMLScriptElement;
       if (!tvScript) {
         tvScript = document.createElement("script");
         tvScript.id = "tradingview-script";
         tvScript.src = "https://s3.tradingview.com/tv.js";
         tvScript.async = true;
         document.body.appendChild(tvScript);
       }
       const intervalId = setInterval(() => {
         // @ts-ignore
         if (window.TradingView) {
            renderChart();
            clearInterval(intervalId);
         }
       }, 500);
       return () => clearInterval(intervalId);
    }
  }, [symbol, timeframe]);

  const toggleTimeframe = () => setTimeframe(t => t === '1' ? '15' : '1');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onDoubleClick={toggleTimeframe}>
      <div className="bg-[#0F0F12] border border-gray-800 rounded-xl w-full max-w-4xl h-[60vh] shadow-2xl overflow-hidden flex flex-col relative" onClick={e => e.stopPropagation()} onDoubleClick={e => { e.stopPropagation(); toggleTimeframe(); }}>
        <div className="p-3 border-b border-gray-800 flex justify-between items-center bg-[#141418]">
          <h3 className="text-sm font-bold text-gray-300 flex items-center gap-2">
            <span className="text-blue-500">{symbol}</span>
            <span className="text-xs bg-gray-800 px-2 py-0.5 rounded text-gray-400">MA60</span>
            <span className="text-xs bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded border border-blue-600/30 cursor-pointer hover:bg-blue-600/30 transition-colors" onClick={(e) => { e.stopPropagation(); toggleTimeframe(); }}>
              {timeframe}m <span className="text-[10px] text-gray-500 ml-1">(双击此处或背景切换)</span>
            </span>
          </h3>
          <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="text-gray-500 hover:text-white text-lg leading-none cursor-pointer px-2">✕</button>
        </div>
        <div className="flex-1 bg-[#0A0A0B]" id={containerId} />
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<MarketState[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAlertHistory, setShowAlertHistory] = useState(false);
  const [connected, setConnected] = useState(false);

  // Modals
  const [chartPopup, setChartPopup] = useState<string | null>(null);
  
  // Tabs
  const [activeTab, setActiveTab] = useState<'crypto' | 'futures'>('crypto');

  // Sort state
  const [sortField, setSortField] = useState<keyof MarketState>('dev_1m');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(console.error);

    const sse = new EventSource('/api/stream');
    
    sse.onopen = () => setConnected(true);
    sse.onerror = () => setConnected(false);

    sse.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === 'state') {
          setData(payload.data);
        } else if (payload.type === 'alert') {
          setAlerts(prev => [payload.data, ...prev].slice(0, 100)); // Keep last 100
        }
      } catch(err) {
        console.error("SSE Parse Error", err);
      }
    };

    return () => sse.close();
  }, []);

  const filteredData = data.filter(d => activeTab === 'crypto' ? d.market === 'binance' : (d.market === 'tradingview' || d.market === 'sina'));

  const sortedData = [...filteredData].sort((a, b) => {
    const aVal = Math.abs(a[sortField] as number);
    const bVal = Math.abs(b[sortField] as number);
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const handleSort = (field: keyof MarketState) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const saveConfig = async (newConfig: Config) => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      const updated = await res.json();
      setConfig(updated);
      setShowSettings(false);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="flex h-screen w-full bg-[#0A0A0B] text-gray-300 font-sans overflow-hidden">
      {/* Sidebar - Hidden on mobile */}
      <div className="w-64 border-r border-gray-800 flex flex-col shrink-0 hidden md:flex z-20">
        <div className="p-6 flex items-center gap-3 border-b border-gray-800 bg-[#0F0F12]">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-bold text-white">V</div>
          <span className="font-semibold tracking-wider text-white">VANGUARD v1.0</span>
        </div>
        
        <nav className="flex-1 py-4 px-3 space-y-1">
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-widest">监控中心</div>
          <div className="bg-gray-800/50 text-white px-3 py-2 rounded-md flex items-center gap-3 cursor-default">
            <div className="w-2 h-2 rounded-full bg-green-500"></div> 合约热力图
          </div>
          <div className="px-3 py-2 text-gray-400 hover:bg-gray-800 rounded-md flex items-center gap-3 cursor-pointer transition-colors">
            <div className="w-2 h-2 rounded-full bg-gray-600"></div> 活动警报
          </div>
          
          <div className="pt-4 px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-widest">试验性功能</div>
          <div className="px-3 py-2 text-gray-500 flex items-center gap-3 italic opacity-60">
            <span className="text-xs">[扩展]</span> 未平仓合约
          </div>
          <div className="px-3 py-2 text-gray-500 flex items-center gap-3 italic opacity-60">
            <span className="text-xs">[扩展]</span> 爆仓监控
          </div>
          <div className="px-3 py-2 text-gray-500 flex items-center gap-3 italic opacity-60">
            <span className="text-xs">[内置]</span> 脚本引擎
          </div>
        </nav>

        <div className="p-4 border-t border-gray-800 bg-[#0F0F12]">
          <div className="flex items-center gap-2 text-xs text-gray-500 font-mono">
            <div className={cn("w-2 h-2 rounded-full animate-pulse", connected ? "bg-green-400" : "bg-red-400")}></div>
            {connected ? '币安 API 已连接' : '已断开连接'}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b border-gray-800 flex items-center justify-between px-4 sm:px-8 bg-[#0F0F12] shrink-0 z-10 w-full overflow-x-auto scroolbar-hide">
          <div className="flex gap-4 sm:gap-6 min-w-max">
            <div className="flex flex-col">
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">数据源</span>
              <div className="flex gap-2">
                 <span className="bg-transparent text-sm text-blue-400">币安 & TradingView</span>
              </div>
            </div>
            <div className="h-8 w-[1px] bg-gray-800 self-center"></div>
            <div className="flex flex-col">
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">刷新率</span>
              <span className="text-sm font-mono text-gray-200">{config?.refreshIntervalSeconds || 15}.00s</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4 ml-4">
            <button 
              onClick={() => setShowSettings(true)}
              className="bg-blue-600/10 text-blue-500 px-3 sm:px-4 py-1.5 rounded border border-blue-600/30 text-[10px] sm:text-xs font-semibold cursor-pointer hover:bg-blue-600/20 transition-colors whitespace-nowrap"
            >
              管理阈值
            </button>
            <div className="w-8 h-8 shrink-0 rounded-full border border-gray-700 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 transition-colors cursor-pointer" onClick={() => setShowSettings(true)}>
              <Settings className="w-4 h-4" />
            </div>
          </div>
        </header>

        {/* Content Grid */}
        <main className="flex-1 p-3 sm:p-6 space-y-4 sm:space-y-6 overflow-hidden flex flex-col max-w-[1600px] w-full mx-auto relative z-0">
          {/* Global Alerts Panel */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4 shrink-0">
            <div className="bg-[#141418] border border-gray-800 p-2 sm:p-4 rounded">
              <div className="text-[10px] sm:text-xs text-gray-500 uppercase mb-1 whitespace-nowrap">警报阈值 (1m)</div>
              <div className="text-sm sm:text-2xl font-mono text-white">
                ±{activeTab === 'crypto' ? config?.cryptoMa1mAlertThreshold || 5.0 : config?.futuresMa1mAlertThreshold || 0.5}%
              </div>
              <div className="w-full h-1 bg-gray-800 mt-2 sm:mt-3 rounded-full overflow-hidden"><div className="bg-blue-500 w-3/4 h-full"></div></div>
            </div>
            <div className="bg-[#141418] border border-gray-800 p-2 sm:p-4 rounded">
              <div className="text-[10px] sm:text-xs text-gray-500 uppercase mb-1 whitespace-nowrap">警报阈值 (15m)</div>
              <div className="text-sm sm:text-2xl font-mono text-white">
                ±{activeTab === 'crypto' ? config?.cryptoMa15mAlertThreshold || 10.0 : config?.futuresMa15mAlertThreshold || 1.0}%
              </div>
              <div className="w-full h-1 bg-gray-800 mt-2 sm:mt-3 rounded-full overflow-hidden"><div className="bg-purple-500 w-1/2 h-full"></div></div>
            </div>
            <div 
              className="bg-[#141418] border border-red-900/50 p-2 sm:p-4 rounded relative overflow-hidden flex flex-col cursor-pointer hover:bg-[#1a1518] transition-colors"
              onClick={() => setShowAlertHistory(true)}
            >
              <div className="absolute top-0 right-0 p-1 sm:p-2 text-[8px] sm:text-[10px] text-red-500 font-bold bg-red-500/10 border-b border-l border-red-500/20">实时预警</div>
              <div className="text-[10px] sm:text-xs text-gray-500 uppercase mb-1 whitespace-nowrap">活跃异常</div>
              <div className="text-sm sm:text-2xl font-mono text-red-500">
                {alerts.filter(a => a.type === 'anomaly').length.toString().padStart(2, '0')} <span className="text-[10px] sm:text-xs text-gray-400">次事件 (点击查看)</span>
              </div>
            </div>
          </div>

          <div className="flex flex-1 gap-6 min-h-0 w-full overflow-hidden">
            {/* Top 50 Contracts Table */}
            <div className="bg-[#0F0F12] border border-gray-800 rounded-lg flex flex-col flex-1 min-h-0 relative min-w-0">
              
              {/* Tab Navigation */}
              <div className="flex items-center px-4 border-b border-gray-800 bg-[#141418] shrink-0">
                 <button 
                    onClick={() => setActiveTab('crypto')}
                    className={cn("px-4 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors", activeTab === 'crypto' ? "border-blue-500 text-blue-400" : "border-transparent text-gray-500 hover:text-gray-300")}
                 >虚拟货币 (Binance)</button>
                 <button 
                    onClick={() => setActiveTab('futures')}
                    className={cn("px-4 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors", activeTab === 'futures' ? "border-purple-500 text-purple-400" : "border-transparent text-gray-500 hover:text-gray-300")}
                 >传统期货 (TV关联)</button>
              </div>

              <div className="flex-1 overflow-auto p-0 relative">
                <table className="w-full text-xs sm:text-sm text-left font-mono">
                  <thead className="text-[10px] font-bold text-gray-500 uppercase tracking-widest bg-[#141418] sticky top-0 z-10 border-b border-gray-800 shadow-sm leading-tight">
                    <tr>
                      <th className="px-2 sm:px-6 py-2 sm:py-3 font-medium">合约</th>
                      <th className="px-2 sm:px-6 py-2 sm:py-3 font-medium text-right">最新价</th>
                      <th className="px-2 sm:px-6 py-2 sm:py-3 font-medium text-right cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('dev_1m')}>
                        <span className="flex justify-end items-center gap-1">1m偏离 {sortField === 'dev_1m' && (sortDir === 'asc' ? '↑' : '↓')}</span>
                      </th>
                      <th className="px-2 sm:px-6 py-2 sm:py-3 font-medium text-right cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('dev_15m')}>
                         <span className="flex justify-end items-center gap-1">15m偏离 {sortField === 'dev_15m' && (sortDir === 'asc' ? '↑' : '↓')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedData.map((row) => {
                      const alertThreshold1m = row.market === 'binance' ? (config?.cryptoMa1mAlertThreshold || 5) : (config?.futuresMa1mAlertThreshold || 0.5);
                      const alertThreshold15m = row.market === 'binance' ? (config?.cryptoMa15mAlertThreshold || 10) : (config?.futuresMa15mAlertThreshold || 1.0);
                      
                      return (
                      <tr key={row.symbol} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                        <td className="px-2 sm:px-6 py-3 sm:py-4 font-semibold text-white whitespace-nowrap flex items-center gap-2 sm:gap-3">
                          {/* Traffic light indicator */}
                          {Math.abs(row.dev_1m) > alertThreshold1m ? (
                             row.dev_1m > 0 ? 
                             <div className="w-2 h-2 shrink-0 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)] animate-pulse" title="大涨"></div> :
                             <div className="w-2 h-2 shrink-0 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)] animate-pulse" title="大跌"></div>
                          ) : (
                             Math.abs(row.dev_1m) > alertThreshold1m / 2 ?
                             (row.dev_1m > 0 ? <div className="w-2 h-2 shrink-0 rounded-full bg-teal-400" title="升温"></div> :
                                               <div className="w-2 h-2 shrink-0 rounded-full bg-orange-500" title="冷却"></div>)
                             :
                             <div className="w-2 h-2 shrink-0 rounded-full bg-gray-700" title="稳定"></div>
                          )}
                          <span className="flex flex-col">
                            <span>{symbolNameMap[row.symbol] || row.symbol}</span>
                            {symbolNameMap[row.symbol] && <span className="text-[10px] text-gray-500 font-mono">{row.symbol}</span>}
                          </span>
                        </td>
                        <td className="px-2 sm:px-6 py-3 sm:py-4 text-right text-gray-300">{(row.price || 0).toFixed(4)}</td>
                        <td className="px-2 sm:px-6 py-3 sm:py-4 text-right cursor-pointer hover:bg-blue-900/20 transition-colors group" title="点击查看K线图" onClick={() => setChartPopup(row.symbol)}>
                          <span className={cn(
                             "relative pb-0.5", 
                             row.dev_1m > 0 ? "text-blue-400" : "text-red-400", 
                             Math.abs(row.dev_1m) > alertThreshold1m && "font-bold",
                             "border-b border-dashed border-gray-600 group-hover:border-current"
                          )}>
                             {row.dev_1m > 0 ? '+' : ''}{(row.dev_1m || 0).toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-2 sm:px-6 py-3 sm:py-4 text-right cursor-pointer hover:bg-purple-900/20 transition-colors group" title="点击查看K线图" onClick={() => setChartPopup(row.symbol)}>
                          <span className={cn(
                             "relative pb-0.5",
                             row.dev_15m > 0 ? "text-blue-400" : "text-red-500", 
                             Math.abs(row.dev_15m) > alertThreshold15m && "font-bold",
                             "border-b border-dashed border-gray-600 group-hover:border-current"
                          )}>
                            {row.dev_15m > 0 ? '+' : ''}{(row.dev_15m || 0).toFixed(2)}%
                          </span>
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
                {data.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-500 font-sans text-sm">
                    <RefreshCcw className="w-4 h-4 animate-spin mr-2" /> 正在初始化引擎...
                  </div>
                )}
              </div>
              
              <div className="p-2 sm:p-3 bg-[#0A0A0B] border-t border-gray-800 flex justify-between items-center px-4 sm:px-6 shrink-0 relative z-20">
                <span className="text-[9px] sm:text-[10px] text-gray-600 uppercase font-mono tracking-widest">
                  监控板块: {activeTab === 'crypto' ? '币安合约' : '传统期货'} | 共 {filteredData.length} 个标的
                </span>
                <div className="flex gap-2">
                  <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-gray-700 animate-pulse"></div>
                  <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-gray-700 animate-pulse" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>

            {/* Alerts Log */}
            <div className="w-[300px] xl:w-[350px] bg-[#0F0F12] border border-gray-800 rounded-lg flex flex-col min-h-0 shrink-0 hidden lg:flex">
              <div className="px-6 py-3 border-b border-gray-800 text-[10px] font-bold text-gray-500 uppercase tracking-widest bg-[#141418] rounded-t-lg shrink-0 flex justify-between items-center">
                 <span>事件日志</span>
                 <span className="text-blue-500/80">{alerts.length} 条记录</span>
              </div>
              <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-2 font-mono text-xs">
                {alerts.length === 0 ? (
                    <div className="text-gray-600 text-center py-8 font-sans">等待信号中...</div>
                ) : (
                    alerts.map((alert, i) => (
                        <div key={`${alert.timestamp}-${i}`} className="p-3 rounded bg-[#141418] border border-gray-800/80 flex flex-col gap-1 hover:border-gray-700 transition-colors">
                            <div className="flex justify-between items-center text-[10px] text-gray-500">
                               <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                               <span className={cn("px-1.5 rounded font-sans tracking-wider", alert.type === 'anomaly' ? "bg-red-500/10 text-red-500 font-bold border border-red-500/20" : "bg-blue-500/10 text-blue-500 font-bold border border-blue-500/20")}>{alert.type === 'anomaly' ? '异常' : '警报'}</span>
                            </div>
                            <div className="text-gray-400 mt-1">
                               <span className={cn("font-bold mr-2", alert.type === 'anomaly' ? "text-red-400" : "text-gray-200")}>{alert.symbol}</span>
                               <span className="font-sans leading-relaxed text-gray-400">{alert.message}</span>
                            </div>
                        </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Modals */}
      {chartPopup && (
        <ChartModal symbol={chartPopup} onClose={() => setChartPopup(null)} />
      )}

      {showAlertHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
             onClick={() => setShowAlertHistory(false)}>
           <div className="bg-[#0F0F12] border border-gray-800 rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden shadow-2xl shadow-red-900/10"
                onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center p-4 border-b border-gray-800 bg-[#141418]">
                 <h3 className="text-white font-bold flex items-center gap-2 tracking-wider">
                   <AlertTriangle className="w-5 h-5 text-red-500" /> 全局监控报警日志
                 </h3>
                 <button onClick={() => setShowAlertHistory(false)} className="text-gray-500 hover:text-white cursor-pointer px-2">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#0A0A0B]">
                 {alerts.length === 0 ? (
                    <div className="text-center text-gray-500 py-10 font-mono tracking-widest text-sm">监控网内暂无任何异常波动</div>
                 ) : (
                    alerts.map((alert, idx) => (
                       <div key={`${alert.timestamp}-${idx}`} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-[#141418] border border-gray-800 rounded gap-3 sm:gap-2 hover:border-gray-700 transition-colors group">
                          <div className="flex justify-between sm:justify-start items-center gap-4">
                             <div className="flex items-center gap-3 w-40 shrink-0">
                               <span className={cn("px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-widest shrink-0",
                                  alert.type === 'anomaly' ? "bg-red-500/10 text-red-500 border border-red-500/20" : "bg-orange-500/10 text-orange-500 border border-orange-500/20"
                               )}>
                                  {alert.type === 'anomaly' ? '瞬时暴拉/砸盘' : '均线超界限'}
                               </span>
                             </div>
                             <div className="flex items-center gap-2">
                               <span className="text-white font-mono font-bold text-sm">
                                 {symbolNameMap[alert.symbol] || alert.symbol}
                               </span>
                               <span className="text-gray-500 text-xs mt-0.5">{alert.symbol}</span>
                             </div>
                          </div>
                          <div className="flex flex-col sm:items-end flex-1 pl-0 sm:pl-4">
                             <span className={cn("text-sm", alert.type === 'anomaly' ? "text-gray-300 group-hover:text-red-300" : "text-gray-400 group-hover:text-orange-300")}>
                               {alert.message}
                             </span>
                             <span className="text-[10px] text-gray-600 font-mono mt-1">
                               {new Date(alert.timestamp).toLocaleString('zh-CN', { hour12: false })}
                             </span>
                          </div>
                       </div>
                    ))
                 )}
              </div>
           </div>
        </div>
      )}

      {showSettings && config && (
        <SettingsModal 
           config={config} 
           onClose={() => setShowSettings(false)} 
           onSave={saveConfig} 
        />
      )}
    </div>
  );
}

function SettingsModal({ config, onClose, onSave }: { config: Config, onClose: () => void, onSave: (c: Config) => void }) {
  const [form, setForm] = useState(config);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0F0F12] border border-gray-800 rounded-xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col font-sans">
        <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-[#141418]">
          <h3 className="text-xs font-bold text-gray-400 tracking-widest uppercase">警报阈值设置</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors cursor-pointer px-2">✕</button>
        </div>
        
        <div className="p-5 flex flex-col gap-6 text-sm overflow-y-auto bg-[#0A0A0B] max-h-[70vh]">
           {/* General Settings */}
           <div>
             <h4 className="text-gray-500 mb-3 font-semibold uppercase text-[10px] tracking-widest border-b border-gray-800 pb-2">数据源配置</h4>
             <div className="grid grid-cols-1 gap-5">
                <div className="flex flex-col gap-3">
                   <label className="flex items-center gap-3 cursor-pointer group">
                      <div className="relative">
                        <input type="checkbox" className="sr-only" checked={form.enableCrypto} onChange={e => setForm({...form, enableCrypto: e.target.checked})} />
                        <div className={cn("block w-10 h-6 rounded-full transition-colors", form.enableCrypto ? "bg-blue-600" : "bg-gray-700")}></div>
                        <div className={cn("dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform", form.enableCrypto ? "transform translate-x-4" : "")}></div>
                      </div>
                      <div className="text-sm font-semibold text-gray-300 group-hover:text-white transition-colors">虚拟货币 (Binance)</div>
                   </label>
                   
                   <label className="flex items-center gap-3 cursor-pointer group">
                      <div className="relative">
                        <input type="checkbox" className="sr-only" checked={form.enableFutures} onChange={e => setForm({...form, enableFutures: e.target.checked})} />
                        <div className={cn("block w-10 h-6 rounded-full transition-colors", form.enableFutures ? "bg-purple-600" : "bg-gray-700")}></div>
                        <div className={cn("dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform", form.enableFutures ? "transform translate-x-4" : "")}></div>
                      </div>
                      <div className="text-sm font-semibold text-gray-300 group-hover:text-white transition-colors">传统期货 (TradingView / Yahoo)</div>
                   </label>
                </div>

                  {form.enableFutures && (
                   <div className="p-3 bg-gray-800/30 border border-gray-800 rounded">
                      <label className="block text-gray-400 mb-2 text-xs">
                        自选期货代码 (逗号分隔) 
                        <br/>
                        <span className="text-[10px] text-gray-500">国际: GC1!, NQ1! (建议) 或 GC=F (Yahoo)</span>
                        <br/>
                        <span className="text-[10px] text-gray-500">国内: C0, C2607, RB2501 (新浪)</span>
                      </label>
                      <input 
                        type="text" 
                        className="w-full bg-[#141418] border border-gray-700 rounded p-2 text-purple-400 font-mono text-sm focus:border-purple-500 focus:outline-none transition-colors"
                        value={form.tvCustomSymbols.join(', ')}
                        onChange={e => setForm({...form, tvCustomSymbols: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
                        placeholder="GC1!, NQ1!, rb2410"
                      />
                   </div>
                )}

                <div>
                  <label className="block text-gray-400 mb-2 text-xs">刷新间隔 (秒)</label>
                  <input 
                    type="range"
                    min="5" max="60" step="5"
                    className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    value={form.refreshIntervalSeconds}
                    onChange={e => setForm({...form, refreshIntervalSeconds: parseInt(e.target.value)})}
                  />
                  <div className="flex justify-between text-[10px] text-gray-600 mt-1 font-mono">
                    <span>5s</span>
                    <span className="text-blue-500 font-bold">{form.refreshIntervalSeconds}s</span>
                    <span>60s</span>
                  </div>
                </div>
             </div>
           </div>

           {/* 1m Metrics */}
           <div>
             <h4 className="text-gray-500 mb-3 font-semibold uppercase text-[10px] tracking-widest border-b border-gray-800 pb-2">1分钟策略警报阈值</h4>
             <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-blue-400 mb-2 text-xs">虚拟货币 1m 阈值 (%)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    className="w-full bg-[#141418] border border-gray-800 rounded p-2 text-white font-mono text-sm focus:border-blue-500 focus:outline-none transition-colors"
                    value={Number.isNaN(form.cryptoMa1mAlertThreshold) ? '' : form.cryptoMa1mAlertThreshold}
                    onChange={e => setForm({...form, cryptoMa1mAlertThreshold: parseFloat(e.target.value)})}
                  />
                </div>
                <div>
                  <label className="block text-purple-400 mb-2 text-xs">传统期货 1m 阈值 (%)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    className="w-full bg-[#141418] border border-gray-800 rounded p-2 text-white font-mono text-sm focus:border-purple-500 focus:outline-none transition-colors"
                    value={Number.isNaN(form.futuresMa1mAlertThreshold) ? '' : form.futuresMa1mAlertThreshold}
                    onChange={e => setForm({...form, futuresMa1mAlertThreshold: parseFloat(e.target.value)})}
                  />
                </div>
             </div>
           </div>

           {/* 15m Metrics */}
           <div>
             <h4 className="text-gray-500 mb-3 font-semibold uppercase text-[10px] tracking-widest border-b border-gray-800 pb-2">15分钟策略警报阈值</h4>
             <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-blue-400 mb-2 text-xs">虚拟货币 15m 阈值 (%)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    className="w-full bg-[#141418] border border-gray-800 rounded p-2 text-white font-mono text-sm focus:border-blue-500 focus:outline-none transition-colors"
                    value={Number.isNaN(form.cryptoMa15mAlertThreshold) ? '' : form.cryptoMa15mAlertThreshold}
                    onChange={e => setForm({...form, cryptoMa15mAlertThreshold: parseFloat(e.target.value)})}
                  />
                </div>
                <div>
                  <label className="block text-purple-400 mb-2 text-xs">传统期货 15m 阈值 (%)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    className="w-full bg-[#141418] border border-gray-800 rounded p-2 text-white font-mono text-sm focus:border-purple-500 focus:outline-none transition-colors"
                    value={Number.isNaN(form.futuresMa15mAlertThreshold) ? '' : form.futuresMa15mAlertThreshold}
                    onChange={e => setForm({...form, futuresMa15mAlertThreshold: parseFloat(e.target.value)})}
                  />
                </div>
             </div>
           </div>
           
           {/* Anomaly Detection */}
           <div>
             <h4 className="text-gray-500 mb-3 font-semibold uppercase text-[10px] tracking-widest border-b border-gray-800 pb-2 flex justify-between items-center">
                 异常状态引擎
                 <span className="bg-red-500/20 text-red-500 px-1.5 rounded font-mono text-[9px] border border-red-500/30">实验性</span>
             </h4>
             <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-gray-400 mb-2 text-xs">价格激增跳变阈值 (%)</label>
                  <input 
                    type="number" 
                    step="1"
                    className="w-full bg-[#141418] border border-gray-800 rounded p-2 text-white font-mono text-sm focus:border-red-500 focus:outline-none transition-colors"
                    value={Number.isNaN(form.anomalyThresholdPercent) ? '' : form.anomalyThresholdPercent}
                    onChange={e => setForm({...form, anomalyThresholdPercent: parseFloat(e.target.value)})}
                  />
                </div>
                <div>
                  <label className="block text-gray-400 mb-2 text-xs">历史回溯窗口 (秒)</label>
                  <input 
                    type="number" 
                    step="10"
                    className="w-full bg-[#141418] border border-gray-800 rounded p-2 text-white font-mono text-sm focus:border-red-500 focus:outline-none transition-colors"
                    value={Number.isNaN(form.anomalyTimeframeSeconds) ? '' : form.anomalyTimeframeSeconds}
                    onChange={e => setForm({...form, anomalyTimeframeSeconds: parseInt(e.target.value)})}
                  />
                </div>
             </div>
           </div>

           {/* Status Light Legend */}
           <div>
             <h4 className="text-gray-500 mb-3 font-semibold uppercase text-[10px] tracking-widest border-b border-gray-800 pb-2">偏离状态指示灯图例</h4>
             <div className="grid grid-cols-2 gap-3 text-xs text-gray-400">
               <div className="flex items-center gap-2"><div className="w-2 h-2 shrink-0 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)] animate-pulse"></div> 大涨 (超1m阈值)</div>
               <div className="flex items-center gap-2"><div className="w-2 h-2 shrink-0 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)] animate-pulse"></div> 大跌 (超1m阈值)</div>
               <div className="flex items-center gap-2"><div className="w-2 h-2 shrink-0 rounded-full bg-teal-400"></div> 升温 (超半阈值)</div>
               <div className="flex items-center gap-2"><div className="w-2 h-2 shrink-0 rounded-full bg-orange-500"></div> 冷却 (超半阈值)</div>
               <div className="flex items-center gap-2"><div className="w-2 h-2 shrink-0 rounded-full bg-gray-700"></div> 稳定 (阈值内)</div>
             </div>
           </div>
        </div>
        
        <div className="p-4 border-t border-gray-800 bg-[#141418] flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 text-xs text-gray-400 font-semibold tracking-wider uppercase hover:text-white transition-colors cursor-pointer rounded border border-transparent hover:border-gray-700">放弃修改</button>
          <button onClick={() => onSave(form)} className="px-4 py-1.5 text-xs bg-blue-600/10 hover:bg-blue-600/20 text-blue-500 rounded font-semibold tracking-wider uppercase border border-blue-600/30 transition-colors cursor-pointer">应用规则</button>
        </div>
      </div>
    </div>
  );
}
