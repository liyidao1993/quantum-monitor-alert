import type { StocksCnHotRankItem, StocksCnHotStockItem, StocksCnSectorHeatItem } from '../../../4_Shared_Types/standard_models/marketTypes.js';

export interface IStocksCnHeatApiClient {
  getSectorHeat(kind: 'industry' | 'concept', limit: number): Promise<StocksCnSectorHeatItem[]>;
  getHotStocks(limitPerList: number): Promise<StocksCnHotStockItem[]>;
  getHotRank(limit: number): Promise<StocksCnHotRankItem[]>;
}
