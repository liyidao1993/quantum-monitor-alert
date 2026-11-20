import type { MarketModuleName } from "../../Quantum_Monitor_System/4_Shared_Types/standard_models/marketTypes";
import type { QuantumTick } from "../useQuantumSSE";

export function selectTicksByMarket(
  ticks: Iterable<QuantumTick>,
  market: MarketModuleName,
): QuantumTick[] {
  return Array.from(ticks).filter((tick) => tick.market === market);
}

