import { z } from 'zod';
import { isPositionConfirmed, UtilityKindSchema, OutageCoverageSchema, type PropertyUtilityStatus, type UtilityKind } from './utility-outages';

export const UtilityCoverageReportSchema = z.object({
  sources: z.array(z.object({
    operatorId: z.string(), name: z.string(), enabled: z.boolean(), current: z.boolean(),
    lastSuccessAt: z.string().nullable(), lastStatus: z.string().nullable(),
    attention: z.enum(['format_changed', 'unreachable']).nullable(),
  })).optional(),
  utility: UtilityKindSchema,
  total: z.number().int().nonnegative(),
  monitored: z.number().int().nonnegative(),
  notMonitored: z.number().int().nonnegative(),
  unavailable: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  approximatePosition: z.number().int().nonnegative(),
  properties: z.array(z.object({
    propertyId: z.string(), coverage: OutageCoverageSchema,
    operatorId: z.string().nullable(), operatorName: z.string().nullable(), approximatePosition: z.boolean(),
  })),
  gaps: z.array(z.object({
    operatorId: z.string(), operatorName: z.string(), reason: z.enum(['not_monitored', 'stale']), count: z.number().int().positive(),
  })),
});
export type UtilityCoverageReport = z.infer<typeof UtilityCoverageReportSchema>;

/** Tenant-scoped callers supply the properties. Approximate positions are an overlapping count. */
export function buildUtilityCoverageReport(properties: Array<{
  id: string; geocodePrecision: string | null | undefined; positionSource: string | null | undefined; statuses: PropertyUtilityStatus[];
}>, utility: UtilityKind): UtilityCoverageReport {
  const report: UtilityCoverageReport = { utility, total: properties.length, monitored: 0, notMonitored: 0, unavailable: 0, unknown: 0, approximatePosition: 0, properties: [], gaps: [] };
  for (const p of properties) {
    const status = p.statuses.find((s) => s.utility === utility);
    const coverage = status?.coverage ?? 'unknown';
    const approximatePosition = !isPositionConfirmed(p.geocodePrecision, p.positionSource);
    if (approximatePosition) report.approximatePosition++;
    if (coverage === 'monitored') report.monitored++;
    else if (coverage === 'not_monitored') report.notMonitored++;
    else if (coverage === 'stale') report.unavailable++;
    else report.unknown++;
    const operator = status?.operator;
    report.properties.push({ propertyId: p.id, coverage, operatorId: operator?.id ?? null, operatorName: operator?.name ?? null, approximatePosition });
    if ((coverage === 'stale' || coverage === 'not_monitored') && operator) {
      const gap = report.gaps.find((g) => g.operatorId === operator.id && g.reason === coverage);
      if (gap) gap.count++;
      else report.gaps.push({ operatorId: operator.id, operatorName: operator.name, reason: coverage, count: 1 });
    }
  }
  report.gaps.sort((a, b) => b.count - a.count || a.operatorName.localeCompare(b.operatorName, 'sv'));
  return report;
}

/** Contains no property/org identifiers, coordinates, names or street addresses. */
export function utilityCoverageLogEntries(reports: UtilityCoverageReport[]) {
  return reports.flatMap((r) => r.gaps.map((g) => ({ utility: r.utility, operatorId: g.operatorId, operatorName: g.operatorName, reason: g.reason, count: g.count })));
}
