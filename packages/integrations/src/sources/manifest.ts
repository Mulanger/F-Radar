import type { SourceId } from '@fastighetsradar/domain';

/**
 * Source / licence manifest (IMPLEMENTATION.md §3.3).
 *
 * `displayPermitted` and `alertsPermitted` stay false until licence/terms review is
 * recorded (`commercialReuseReviewed`). `reviewedAt` is the date the entry was last
 * checked against documentation – NOT a confirmation that the source works.
 */
export type AccessStatus = 'public' | 'requires_key' | 'requires_approval' | 'legal_review' | 'disabled';

export interface SourceManifest {
  id: Exclude<SourceId, 'demo_other'>;
  authority: string;
  label: string;
  docsUrl: string;
  access: AccessStatus;
  licenseUrl?: string;
  commercialReuseReviewed: boolean;
  attributionText: string;
  dataKind: 'forecast' | 'observation' | 'warning' | 'event' | 'static' | 'statistics' | 'geocoding' | 'messaging';
  geographicPrecision: 'point_grid' | 'station' | 'polygon' | 'municipality' | 'county' | 'national' | 'mixed' | 'address_point' | 'n/a';
  coverageNote: string;
  /** Confirmed cadence or "unknown". */
  updatePolicy: string;
  retentionPolicy: string;
  displayPermitted: boolean;
  alertsPermitted: boolean;
  /** Env var(s) that must hold a key/credential for the adapter to run. */
  requiredSecrets: string[];
  /** Env flag that switches the adapter on/off. */
  enableFlag?: string;
  reviewedAt: string;
}

const REVIEWED = '2026-11-12';

export const SOURCE_MANIFEST: Record<Exclude<SourceId, 'demo_other'>, SourceManifest> = {
  smhi_forecast: {
    id: 'smhi_forecast', authority: 'SMHI', label: 'SMHI prognos (SNOW1gv1)',
    docsUrl: 'https://opendata.smhi.se/metfcst/snow1gv1/', access: 'public', commercialReuseReviewed: false,
    attributionText: 'Källa: SMHI', dataKind: 'forecast', geographicPrecision: 'point_grid',
    coverageNote: 'Model point forecast; not an indoor or building-specific value.',
    updatePolicy: 'unknown (initial internal proposal: every 15–30 min)', retentionPolicy: 'Until superseded + short debug margin',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_SMHI_FORECAST_ENABLED', reviewedAt: REVIEWED,
  },
  smhi_warnings: {
    id: 'smhi_warnings', authority: 'SMHI', label: 'SMHI vädervarningar (IBWW)',
    docsUrl: 'https://opendata.smhi.se/warnings/', access: 'public', commercialReuseReviewed: false,
    attributionText: 'Källa: SMHI – oförändrad officiell varning', dataKind: 'warning', geographicPrecision: 'polygon',
    coverageNote: 'Official impact-based warnings; special attribution and unaltered presentation terms apply.',
    updatePolicy: 'unknown (initial internal proposal: every 5–10 min)', retentionPolicy: 'Until expired/cancelled + short timeline',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_SMHI_WARNINGS_ENABLED', reviewedAt: REVIEWED,
  },
  smhi_observations: {
    id: 'smhi_observations', authority: 'SMHI', label: 'SMHI MetObs',
    docsUrl: 'https://opendata.smhi.se/metobs/examples', access: 'public', commercialReuseReviewed: false,
    attributionText: 'Källa: SMHI', dataKind: 'observation', geographicPrecision: 'station',
    coverageNote: 'Station may be far from the property; distance and observation time must be shown.',
    updatePolicy: 'Per station/parameter', retentionPolicy: 'Short window for charts only',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_SMHI_OBSERVATIONS_ENABLED', reviewedAt: REVIEWED,
  },
  smhi_oceanography: {
    id: 'smhi_oceanography', authority: 'SMHI', label: 'SMHI oceanografi (havsvattenstånd)',
    docsUrl: 'https://opendata.smhi.se/', access: 'public', commercialReuseReviewed: false,
    attributionText: 'Källa: SMHI', dataKind: 'observation', geographicPrecision: 'station',
    coverageNote: 'Shown in the approved design (sea level). Not yet listed in IMPLEMENTATION.md §3 – endpoint and terms must be verified before use.',
    updatePolicy: 'unknown', retentionPolicy: 'Short window',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], reviewedAt: REVIEWED,
  },
  krisinformation: {
    id: 'krisinformation', authority: 'MCF / Krisinformation.se', label: 'Krisinformation v3',
    docsUrl: 'https://www.krisinformation.se/om-krisinformation.se/oppen-data/', access: 'public', commercialReuseReviewed: false,
    attributionText: 'Källa: Krisinformation.se', dataKind: 'event', geographicPrecision: 'county',
    coverageNote: 'Area is often county-level; must be labelled regional information, not a local incident.',
    updatePolicy: 'unknown (initial internal proposal: every 10–15 min)', retentionPolicy: 'Until expired + short timeline',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_KRISINFORMATION_ENABLED', reviewedAt: REVIEWED,
  },
  air_quality: {
    id: 'air_quality', authority: 'Naturvårdsverket / SMHI datavärd luft', label: 'Luftkvalitet',
    docsUrl: 'https://www.naturvardsverket.se/amnesomraden/luft/statistik--utslapp-och-halter/luftkvaliteten-i-realtid-och-preliminar-statistik/webbtjanster-luftkvalitetsdata/',
    access: 'public', commercialReuseReviewed: false, attributionText: 'Källa: Naturvårdsverket / SMHI', dataKind: 'observation',
    geographicPrecision: 'station', coverageNote: 'Sparse stations; real-time values may be preliminary. No building AQI without a documented method.',
    updatePolicy: 'Roughly hourly where reported', retentionPolicy: 'Short window',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_AIR_QUALITY_ENABLED', reviewedAt: REVIEWED,
  },
  sgu_groundwater: {
    id: 'sgu_groundwater', authority: 'SGU', label: 'SGU grundvatten',
    docsUrl: 'https://www.sgu.se/produkter-och-tjanster/geologiska-data/grundvatten--geologiska-data/grundvattennivaer/',
    access: 'public', commercialReuseReviewed: false, attributionText: 'Källa: SGU', dataKind: 'observation', geographicPrecision: 'mixed',
    coverageNote: 'Regional 4×4 km HYPE model must not be presented as a basement measurement.',
    updatePolicy: 'Daily/weekly depending on dataset', retentionPolicy: 'Latest value + short history',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_SGU_ENABLED', reviewedAt: REVIEWED,
  },
  mcf_flood: {
    id: 'mcf_flood', authority: 'MCF Översvämningsportalen', label: 'MCF översvämningskartering',
    docsUrl: 'https://www.mcf.se/sv/verktyg--tjanster/oversvamningsportalen/', access: 'legal_review', commercialReuseReviewed: false,
    attributionText: 'Källa: MCF Översvämningsportalen', dataKind: 'static', geographicPrecision: 'polygon',
    coverageNote: 'Static scenarios (e.g. 100-year flow), never a current water level. Layers must be inventoried per region.',
    updatePolicy: 'Scheduled check for dataset revisions', retentionPolicy: 'Imported layer versions',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'MCF_FLOOD_ENABLED', reviewedAt: REVIEWED,
  },
  scb: {
    id: 'scb', authority: 'SCB', label: 'SCB PxWebApi v2',
    docsUrl: 'https://www.scb.se/vara-tjanster/oppna-data/pxwebapi/pxwebapi-v2/', access: 'public', commercialReuseReviewed: false,
    attributionText: 'Källa: SCB', dataKind: 'statistics', geographicPrecision: 'municipality',
    coverageNote: 'Context only; 30 calls/10 s per IP, max 150 000 cells per request.',
    updatePolicy: 'On new publications', retentionPolicy: 'Long cache, versioned by table/year',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_SCB_ENABLED', reviewedAt: REVIEWED,
  },
  trafikverket: {
    id: 'trafikverket', authority: 'Trafikverket', label: 'Trafikverket öppna API',
    docsUrl: 'https://data.trafikverket.se/get-started', access: 'requires_key', commercialReuseReviewed: false,
    licenseUrl: 'https://www.trafikverket.se/e-tjanster/trafikverkets-oppna-api-for-trafikinformation/',
    attributionText: 'Källa: Trafikverket (CC0)', dataKind: 'event', geographicPrecision: 'mixed',
    coverageNote: 'Nearby traffic event ≠ blocked access to the building.',
    updatePolicy: 'Per current documentation and quotas', retentionPolicy: 'Until resolved + short timeline',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: ['TRAFIKVERKET_API_KEY'], enableFlag: 'TRAFIKVERKET_ENABLED', reviewedAt: REVIEWED,
  },
  geoapify_geocoding: {
    id: 'geoapify_geocoding', authority: 'Geoapify', label: 'Geoapify adressökning',
    docsUrl: 'https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/', access: 'requires_key', commercialReuseReviewed: false,
    licenseUrl: 'https://www.geoapify.com/pricing/', attributionText: 'Powered by Geoapify', dataKind: 'geocoding',
    geographicPrecision: 'address_point', coverageNote: 'Address points, not official property boundaries. Free plan: 3 000 credits/day shared.',
    updatePolicy: 'On demand (onboarding only)', retentionPolicy: 'Store confirmed address/point only',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: ['GEOAPIFY_API_KEY'], reviewedAt: REVIEWED,
  },
  lantmateriet_address: {
    id: 'lantmateriet_address', authority: 'Lantmäteriet', label: 'Lantmäteriet Referens Uppslag Adress v3',
    docsUrl: 'https://geotorget.lantmateriet.se/geodataprodukter/referens-uppslag-adress-api', access: 'requires_approval',
    commercialReuseReviewed: false, attributionText: 'Källa: Lantmäteriet', dataKind: 'geocoding', geographicPrecision: 'address_point',
    coverageNote: 'Optional future enrichment. Must not block onboarding.', updatePolicy: 'On demand', retentionPolicy: 'Per agreement',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: ['LANTMATERIET_CLIENT_ID', 'LANTMATERIET_CLIENT_SECRET'],
    enableFlag: 'LANTMATERIET_ENABLED', reviewedAt: REVIEWED,
  },
  boverket_energy: {
    id: 'boverket_energy', authority: 'Boverket', label: 'Boverket energideklarationer',
    docsUrl: 'https://www.boverket.se/sv/om-boverket/oppna-data/publikt-api-for-energideklarationer/', access: 'disabled',
    commercialReuseReviewed: false, attributionText: 'Källa: Boverket', dataKind: 'static', geographicPrecision: 'address_point',
    coverageNote: 'OFF until written clearance for customer-facing SaaS use.', updatePolicy: 'n/a', retentionPolicy: 'n/a',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: ['BOVERKET_API_KEY'], enableFlag: 'BOVERKET_ENABLED', reviewedAt: REVIEWED,
  },
  sms_46elks: {
    id: 'sms_46elks', authority: '46elks', label: '46elks SMS',
    docsUrl: 'https://46elks.se/docs/send-sms', access: 'requires_key', commercialReuseReviewed: false,
    attributionText: '', dataKind: 'messaging', geographicPrecision: 'n/a',
    coverageNote: 'Paid service. Dry-run only until the owner explicitly approves live sending.', updatePolicy: 'n/a',
    retentionPolicy: 'Delivery log ~30 days (proposal, legal decision pending)',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: ['ELKS_API_USERNAME', 'ELKS_API_PASSWORD'],
    enableFlag: 'SMS_ENABLED', reviewedAt: REVIEWED,
  },
};

export const MANIFEST_LIST: SourceManifest[] = Object.values(SOURCE_MANIFEST);
