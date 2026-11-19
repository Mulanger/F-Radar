import type { UtilityCoverageReport } from '@fastighetsradar/domain';
import type { Queryable } from './migrations';

/** Called after property changes. Tenant is checked again in SQL, including input property ids. */
export async function recordUtilityCoverageGaps(db: Queryable, organizationId: string, reports: UtilityCoverageReport[]): Promise<void> {
  const incoming = reports.flatMap((r) => r.properties.flatMap((p) =>
    p.operatorId && p.operatorName && (p.coverage === 'not_monitored' || p.coverage === 'stale')
      ? [{ property_id: p.propertyId, utility: r.utility, operator_id: p.operatorId, operator_name: p.operatorName, reason: p.coverage }] : [],
  ));
  await db.query(`WITH incoming AS (
    SELECT x.* FROM jsonb_to_recordset($2::jsonb) AS x(property_id uuid, utility text, operator_id text, operator_name text, reason text)
    JOIN properties p ON p.id = x.property_id AND p.organization_id = $1
  ), written AS (
    INSERT INTO utility_coverage_gaps (property_id, organization_id, utility, operator_id, operator_name, reason)
    SELECT property_id, $1, utility, operator_id, operator_name, reason FROM incoming
    ON CONFLICT (property_id, utility) DO UPDATE SET
      operator_id = EXCLUDED.operator_id, operator_name = EXCLUDED.operator_name, reason = EXCLUDED.reason,
      detected_at = CASE WHEN utility_coverage_gaps.operator_id <> EXCLUDED.operator_id OR utility_coverage_gaps.resolved_at IS NOT NULL
        THEN now() ELSE utility_coverage_gaps.detected_at END,
      last_detected_at = now(), resolved_at = NULL
    WHERE utility_coverage_gaps.organization_id = $1
    RETURNING property_id
  )
  UPDATE utility_coverage_gaps g SET resolved_at = now()
  WHERE g.organization_id = $1 AND g.utility = ANY($3::text[]) AND g.resolved_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.property_id = g.property_id AND i.utility = g.utility)`,
  [organizationId, JSON.stringify(incoming), reports.map((r) => r.utility)]);
}
