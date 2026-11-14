/** EEA station index, revised bands checked 2026-11-14. ADR 0007. */
export const EEA_METHOD = 'eea_hourly_2024_v1';
export const EEA_LABELS = ['Bra', 'Acceptabel', 'Måttlig', 'Dålig', 'Mycket dålig', 'Extremt dålig'] as const;
export const EEA_BOUNDS: Record<string, number[]> = {
  pm25: [5, 15, 50, 90, 140], pm10: [15, 45, 120, 195, 270],
  no2: [10, 25, 60, 100, 150], o3: [60, 100, 120, 160, 180], so2: [20, 40, 125, 190, 275],
};
export interface AirIndexSample {
  stationId: string; stationName: string; distanceMeters: number; parameter: string;
  value: number | null; observedAt: string | null; resolution: unknown; classification: unknown;
}

export function eeaBand(parameter: string, value: number): number | null {
  const bounds = EEA_BOUNDS[parameter];
  if (!bounds || !Number.isFinite(value) || value < 0) return null;
  // Consecutive published integer ranges are applied as continuous upper bounds.
  const i = bounds.findIndex((b) => value <= b);
  return i < 0 ? 6 : i + 1;
}

export function stationAirIndex(samples: AirIndexSample[], now: Date) {
  const groups = new Map<string, AirIndexSample[]>();
  for (const s of samples) {
    if (s.resolution !== 'hour' || s.value === null || !EEA_BOUNDS[s.parameter] || !s.observedAt || s.distanceMeters > 25_000) continue;
    const t = Date.parse(s.observedAt);
    if (!Number.isFinite(t) || t > now.getTime() || now.getTime() - t > 3 * 3_600_000 || t % 3_600_000 !== 0) continue;
    const key = `${s.stationId}:${s.observedAt}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const candidates = [...groups.values()].flatMap((g) => {
    const s = g[0]!;
    const classification = String(s.classification ?? '');
    const traffic = /gaturum|traffic/i.test(classification);
    if (!traffic && !/bakgrund|background|industr/i.test(classification)) return [];
    const values = new Map(g.filter((x) => eeaBand(x.parameter, x.value!) !== null).map((x) => [x.parameter, x.value!]));
    if (!values.has('no2') || (!values.has('pm25') && !values.has('pm10')) || (!traffic && !values.has('o3'))) return [];
    const band = Math.max(...[...values].map(([p, v]) => eeaBand(p, v)!));
    return [{ stationId: s.stationId, stationName: s.stationName, distanceMeters: s.distanceMeters, observedAt: s.observedAt!, classification, band, label: EEA_LABELS[band - 1]!, pollutants: [...values.keys()], missingPollutants: Object.keys(EEA_BOUNDS).filter((p) => !values.has(p)), method: EEA_METHOD as typeof EEA_METHOD }];
  });
  return candidates.sort((a, b) => a.distanceMeters - b.distanceMeters || Date.parse(b.observedAt) - Date.parse(a.observedAt))[0] ?? null;
}
