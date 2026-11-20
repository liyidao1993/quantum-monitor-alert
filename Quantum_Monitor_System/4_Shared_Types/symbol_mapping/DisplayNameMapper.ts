export type DisplayNameMarket = 'Futures_CN' | 'Futures_Global';

export interface DisplayNameResult {
  symbol: string;
  displayName?: string;
  contractMonthLabel?: string;
}

const CN_FUTURES_NAMES: Record<string, string> = {
  A: '豆一',
  AG: '白银',
  AL: '沪铝',
  AO: '氧化铝',
  AP: '苹果',
  AU: '黄金',
  B: '豆二',
  BC: '国际铜',
  BR: '丁二烯橡胶',
  BU: '沥青',
  C: '玉米',
  CF: '棉花',
  CJ: '红枣',
  CS: '淀粉',
  CU: '沪铜',
  CY: '棉纱',
  EB: '苯乙烯',
  EC: '集运指数',
  FB: '纤维板',
  FG: '玻璃',
  FU: '燃油',
  HC: '热卷',
  I: '铁矿石',
  IC: '中证500指数',
  IF: '沪深300指数',
  IH: '上证50指数',
  IM: '中证1000指数',
  J: '焦炭',
  JD: '鸡蛋',
  JM: '焦煤',
  L: '塑料',
  LC: '碳酸锂',
  LH: '生猪',
  LU: '低硫燃油',
  M: '豆粕',
  MA: '甲醇',
  NI: '沪镍',
  NR: '20号胶',
  OI: '菜油',
  P: '棕榈油',
  PB: '沪铅',
  PF: '短纤',
  PG: '液化气',
  PK: '花生',
  PP: '聚丙烯',
  RB: '螺纹钢',
  RM: '菜粕',
  RU: '橡胶',
  SA: '纯碱',
  SC: '上海原油',
  SF: '硅铁',
  SI: '工业硅',
  SM: '锰硅',
  SN: '沪锡',
  SP: '纸浆',
  SR: '白糖',
  SS: '不锈钢',
  TA: 'PTA',
  T: '10年国债',
  TF: '5年国债',
  TL: '30年国债',
  TS: '2年国债',
  UR: '尿素',
  V: 'PVC',
  Y: '豆油',
  ZN: '沪锌',
};

const GLOBAL_FUTURES_NAMES: Record<string, string> = {
  CL: '美原油',
  ES: '标普500',
  GC: '美黄金',
  HG: '美铜',
  NG: '天然气',
  NQ: '纳指100',
  RB: 'RBOB汽油',
  RTY: '罗素2000',
  SI: '美白银',
  YM: '道指',
  ZC: '美玉米',
  ZS: '美大豆',
  ZW: '美小麦',
};

export function resolveDisplayName(symbol: string, market: DisplayNameMarket, fallbackName?: string): DisplayNameResult {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return { symbol };
  if (market === 'Futures_CN') return resolveCnFuturesName(normalized, fallbackName);
  return resolveGlobalFuturesName(normalized, fallbackName);
}

function resolveCnFuturesName(symbol: string, fallbackName?: string): DisplayNameResult {
  const root = symbol.match(/^[A-Z]+/)?.[0] ?? symbol;
  const digits = symbol.slice(root.length);
  if (fallbackName) {
    return {
      symbol,
      displayName: fallbackName,
      contractMonthLabel: fallbackName.endsWith('连续') ? '连续' : digits || undefined,
    };
  }

  const baseName = CN_FUTURES_NAMES[root];
  if (!baseName) return { symbol };

  const contractMonthLabel = digits === '0'
    ? '连续'
    : digits || undefined;
  return {
    symbol,
    displayName: contractMonthLabel ? `${baseName}${contractMonthLabel}` : baseName,
    contractMonthLabel,
  };
}

function resolveGlobalFuturesName(symbol: string, fallbackName?: string): DisplayNameResult {
  const root = symbol
    .replace(/^([A-Z]+).*$/, '$1')
    .replace(/=F$/, '')
    .replace(/1!$/, '');
  const baseName = GLOBAL_FUTURES_NAMES[root] ?? fallbackName;
  if (!baseName) return { symbol };

  const isContinuous = symbol.endsWith('1!') || symbol.endsWith('=F');
  return {
    symbol,
    displayName: isContinuous ? `${baseName}连续` : baseName,
    contractMonthLabel: isContinuous ? '连续' : undefined,
  };
}
