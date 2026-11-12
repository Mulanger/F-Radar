import type { DataSourceStatus, Portfolio, PropertyRecord, PropertySnapshot } from '@fastighetsradar/domain';

/**
 * Builds the dashboard `Portfolio` contract from REAL customer records.
 *
 * Phase 2 has no live public-data adapters, so every monitoring field is explicitly
 * empty/unknown – never demo values, never "normal". The UI renders these as
 * "not connected / unavailable" (IMPLEMENTATION.md §1, §20).
 */
export function propertyToSnapshot(p: PropertyRecord, clerkOrgId: string): PropertySnapshot {
  const precision = (['building', 'street', 'approximate'] as const).includes(p.geocode.precision as 'building')
    ? (p.geocode.precision as 'building' | 'street' | 'approximate')
    : 'unknown';
  return {
    property: {
      id: p.id,
      organizationId: clerkOrgId,
      name: p.name,
      address: p.address,
      area: p.geocode.city ?? p.geocode.municipality ?? '',
      municipality: p.geocode.municipality,
      countyCode: null,
      segment: 'all',
      location: p.location,
      geocode: {
        provider: p.geocode.provider === 'geoapify' ? 'geoapify' : 'manual_pin',
        precision,
        confirmedAt: p.updatedAt,
      },
      building: null,
      status: 'unknown',
      statusReason: 'No public-data sources connected yet',
      origin: 'live',
    },
    metrics: [],
    forecast: null,
    warnings: [],
    events: [],
    flood: {
      propertyId: p.id,
      mapped: {
        sourceId: 'mcf_flood',
        exposureClass: 'unknown',
        scenario: null,
        distanceToZoneMeters: null,
        availability: 'unknown',
        geo: { match: 'not_matched', note: 'MCF flood layers not connected' },
        origin: 'live',
      },
      waterBody: null,
    },
    alertRules: [],
    sms: { enabled: false, recipientsLabel: 'No verified recipients', recipientCount: 0 },
    activeAlertCount: 0,
    demoRisk: null,
  };
}

export function buildLivePortfolio(input: {
  clerkOrgId: string;
  orgSlug: string | null;
  properties: PropertyRecord[];
  sources: DataSourceStatus[];
  now?: Date;
}): Portfolio {
  return {
    organizationId: input.clerkOrgId,
    organizationName: input.orgSlug ?? 'Organization',
    generatedAt: (input.now ?? new Date()).toISOString(),
    origin: 'live',
    regionLabel: 'Sweden',
    segments: [],
    properties: input.properties.map((p) => propertyToSnapshot(p, input.clerkOrgId)),
    feed: [],
    upcoming: [],
    sources: input.sources,
    narrative: null,
    demoTrends: null,
    // The API does not hold user profile data; Next.js fills this from Clerk.
    viewer: { displayName: '', role: '', initials: '' },
  };
}
