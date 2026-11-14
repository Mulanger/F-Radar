/** SMHI's Celsius/m/s wind-chill formula. ADR 0006, not a heat index. */
export function windChill(temperature: number | null, windMs: number | null): number | null {
  if (temperature === null || windMs === null || !Number.isFinite(temperature) || !Number.isFinite(windMs)) return null;
  // SMHI explicitly forbids extrapolation outside these bounds.
  if (temperature < -40 || temperature > 10 || windMs < 1.3 || windMs > 35) return null;
  return Math.round((13.12 + 0.6215 * temperature - 13.956 * windMs ** 0.16 + 0.48669 * temperature * windMs ** 0.16) * 10) / 10;
}
