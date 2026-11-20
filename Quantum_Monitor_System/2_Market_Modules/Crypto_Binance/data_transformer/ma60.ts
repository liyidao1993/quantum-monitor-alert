export function average(values: number[]): number {
  if (values.length === 0) {
    throw new Error('Cannot calculate average for an empty value list.');
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateDeviationPercent(currentPrice: number, maSnapshot: number): number {
  if (maSnapshot <= 0) {
    throw new Error('MA snapshot must be greater than zero.');
  }

  return ((currentPrice - maSnapshot) / maSnapshot) * 100;
}

