import type { OutageKind, OutagePrecision, OutageState, UtilityKind } from '@fastighetsradar/domain';
import type { GeoJsonGeometry } from '../types';

/** One outage as published by a grid operator, normalised (docs/plans/stromavbrott.md §5.2). */
export interface NormalizedUtilityOutage {
  operatorId: string;
  utility: UtilityKind;
  /** `${operatorId}:${upstreamId}` – stable across polls. */
  externalId: string;
  kind: OutageKind;
  state: OutageState;
  affectedCustomers: number | null;
  areaCustomerTotal: number | null;
  reportedAt: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  estimatedRestore: string | null;
  restoredAt: string | null;
  precision: OutagePrecision;
  /** WGS84 lon/lat, validated inside Sweden. */
  geometry: GeoJsonGeometry | null;
  addresses: Array<{ street: string; numbers: string[] | null }> | null;
  postalCodes: string[];
  municipalityCode: string | null;
  placeLabel: string | null;
  /** Operator's customer text, verbatim. */
  operatorText: string | null;
  /** Operator's cause text, verbatim. */
  cause: string | null;
  /** Public outage map page (never the API URL). */
  sourceUrl: string;
  /** Minimal upstream fields for debugging; never contains addresses. */
  upstream: Record<string, unknown>;
}

export interface OutageFetchResult {
  outages: NormalizedUtilityOutage[];
  /** Records that could not be validated (bad geometry/time/shape). A non-zero value makes the run partial. */
  skipped: number;
  /** Records deliberately ignored (e.g. planned work without customer impact). */
  ignored: number;
  sourceUpdatedAt: string | null;
  /** Upstream status codes the adapter does not know (logged so the mapping can be extended). */
  unknownStatusCodes?: string[];
}

export interface ConcessionArea {
  externalRef: string | null;
  geometry: GeoJsonGeometry;
}

export type UtilityOperatorPlatform = 'vattenfall' | 'digpro' | 'goteborg_energi';

interface OperatorBase {
  /** Stable id used in job ids, external ids and UTILITY_OUTAGE_OPERATORS. */
  id: string;
  /** Display name shown to customers. */
  name: string;
  utilities: UtilityKind[];
  /** Public map page linked from the dashboard. */
  mapUrl: string;
}
export type UtilityOperator =
  | (OperatorBase & { platform: 'vattenfall'; dataUrl: string })
  | (OperatorBase & { platform: 'digpro'; host: string; cust: string; concessionUrl: string | null })
  | (OperatorBase & { platform: 'goteborg_energi'; apiBase: string; utilityTypeIds: Partial<Record<UtilityKind, string>> });
