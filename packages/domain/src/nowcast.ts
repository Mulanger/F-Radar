import { z } from 'zod';
import { WEATHER_WATER as T } from './weather-information';
import { FreshnessSchema, IsoDateTimeSchema } from './common';

export const NowcastPointSchema = z.object({ validAt: IsoDateTimeSchema, rateMmH: z.number().nonnegative().nullable() });
export type NowcastPoint = z.infer<typeof NowcastPointSchema>;
export const RadarCoverageSchema = z.enum(['ok', 'temporarily unavailable', 'no coverage']);
export const NowcastSummarySchema = z.object({
  state: z.enum(['dry', 'starting', 'ongoing', 'ending', 'unavailable']),
  startsAt: IsoDateTimeSchema.nullable(), endsAt: IsoDateTimeSchema.nullable(),
  peakRateMmH: z.number().nullable(), peakAt: IsoDateTimeSchema.nullable(), totalNext60Mm: z.number().nullable(),
  intensity: z.enum(['lätt', 'måttligt', 'kraftigt', 'skyfallsintensitet']).nullable(),
  phase: z.enum(['rain', 'mixed', 'snow', 'unknown']),
});
export const NowcastSchema = z.object({
  sourceId: z.literal('met_nowcast'), coverage: RadarCoverageSchema,
  updatedAt: IsoDateTimeSchema.nullable(), fetchedAt: IsoDateTimeSchema, freshness: FreshnessSchema,
  points: z.array(NowcastPointSchema), summary: NowcastSummarySchema, attribution: z.string(),
  origin: z.enum(['live', 'demo_fixture']).optional(),
});
export type Nowcast = z.infer<typeof NowcastSchema>;

/** Points describe five-minute rate intervals. Missing intervals are never dry intervals. */
export function summarizeNowcast(points: NowcastPoint[], now: Date, temperature: number | null,
  options: { coverage?: z.infer<typeof RadarCoverageSchema>; fetchedAt?: string } = {}): z.infer<typeof NowcastSummarySchema> {
  const empty: z.infer<typeof NowcastSummarySchema> = { state:'unavailable', startsAt:null, endsAt:null, peakRateMmH:null, peakAt:null, totalNext60Mm:null, intensity:null, phase:'unknown' };
  const age = options.fetchedAt ? +now - Date.parse(options.fetchedAt) : 0;
  if ((options.coverage && options.coverage !== 'ok') || age > T.nowcastUsableMinutes * 60_000 || age < 0) return empty;
  const sorted = [...points].sort((a,b)=>a.validAt.localeCompare(b.validAt));
  const p = sorted.filter(x => Date.parse(x.validAt) + 300_000 > +now && Date.parse(x.validAt) < +now + 7_200_000);
  if (p.length < 2 || Date.parse(p[0]!.validAt) > +now + 300_000 || p.some((x,i) => x.rateMmH == null || (i > 0 && Date.parse(x.validAt) - Date.parse(p[i-1]!.validAt) !== 300_000))) return empty;
  const wet = p.filter(x => x.rateMmH! >= T.nowcastNoiseMmH), first = wet[0];
  const currentlyWet = p[0]!.rateMmH! >= T.nowcastNoiseMmH && Date.parse(p[0]!.validAt) <= +now;
  // First end of the first contiguous precipitation spell; a later shower is not merged into it.
  const firstIndex = first ? p.indexOf(first) : -1;
  const end = firstIndex >= 0 ? p.slice(firstIndex + 1).find(x=>x.rateMmH! < T.nowcastNoiseMmH) : null;
  let total = 0, covered = 0;
  for (const x of p) {
    const overlap = Math.min(+now+3_600_000, Date.parse(x.validAt)+300_000) - Math.max(+now, Date.parse(x.validAt));
    if (overlap > 0) { covered += overlap; total += (x.rateMmH! >= T.nowcastNoiseMmH ? x.rateMmH! : 0) * overlap / 3_600_000; }
  }
  const spell=firstIndex<0?[]:p.slice(firstIndex,end?p.indexOf(end):undefined);
  const peak=spell.reduce<NowcastPoint|null>((a,b)=>!a||b.rateMmH!>a.rateMmH!?b:a,null);
  const rate = peak?.rateMmH ?? 0;
  return { state: !first ? 'dry' : !currentlyWet ? 'starting' : end ? 'ending' : 'ongoing',
    startsAt: first?.validAt ?? null, endsAt: end?.validAt ?? null, peakRateMmH: rate, peakAt: peak?.validAt ?? null,
    totalNext60Mm: covered === 3_600_000 ? Math.round(total*100)/100 : null,
    intensity: !first ? null : rate < T.moderateMmH ? 'lätt' : rate < T.heavyMmH ? 'måttligt' : rate < T.cloudburstMmH ? 'kraftigt' : 'skyfallsintensitet',
    phase: temperature == null ? 'unknown' : temperature <= T.snowMaxC ? 'snow' : temperature < T.mixedMaxC ? 'mixed' : 'rain' };
}
