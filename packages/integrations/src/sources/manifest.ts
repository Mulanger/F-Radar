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
  dataKind: 'forecast' | 'model' | 'observation' | 'warning' | 'event' | 'static' | 'statistics' | 'geocoding' | 'messaging';
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
const VERIFIED = '2026-11-13';

export const SOURCE_MANIFEST: Record<Exclude<SourceId, 'demo_other'>, SourceManifest> = {
  smhi_forecast: {
    id: 'smhi_forecast', authority: 'SMHI', label: 'SMHI prognos (SNOW1gv1)',
    docsUrl: 'https://opendata.smhi.se/metfcst/snow1gv1/', access: 'public', commercialReuseReviewed: false,
    attributionText: 'Källa: SMHI', dataKind: 'forecast', geographicPrecision: 'point_grid',
    coverageNote: 'Model point forecast; derived wind chill only within SMHI bounds (ADR 0004). Not an indoor or building-specific value.',
    updatePolicy: 'Model run hourly (Cache-Control max-age=3600); collected every 60 min per property point', retentionPolicy: 'Latest run only (superseded on refresh)',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_SMHI_FORECAST_ENABLED', reviewedAt: '2026-11-14',
  },
  smhi_warnings: {
    id: 'smhi_warnings', authority: 'SMHI', label: 'SMHI vädervarningar (IBWW)',
    docsUrl: 'https://opendata.smhi.se/warnings/', access: 'public', commercialReuseReviewed: false,
    attributionText: 'Källa: SMHI – oförändrad officiell varning', dataKind: 'warning', geographicPrecision: 'polygon',
    coverageNote: 'Official impact-based warnings; special attribution and unaltered presentation terms apply.',
    updatePolicy: 'Event-driven; collected every 5 min (whole country, one request)', retentionPolicy: 'Active + 7 days after end',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_SMHI_WARNINGS_ENABLED', reviewedAt: VERIFIED,
  },
  smhi_observations: {
    id: 'smhi_observations', authority: 'SMHI', label: 'SMHI MetObs',
    docsUrl: 'https://opendata.smhi.se/metobs/examples', access: 'public', commercialReuseReviewed: false,
    attributionText: 'Källa: SMHI', dataKind: 'observation', geographicPrecision: 'station',
    coverageNote: 'Station may be far from the property; distance and observation time must be shown.',
    updatePolicy: 'Hourly per station; latest-hour sets collected every 30 min (6 parameters)', retentionPolicy: 'Latest value per station/parameter; stations silent > 2 days dropped',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_SMHI_OBSERVATIONS_ENABLED', reviewedAt: VERIFIED,
  },
  smhi_oceanography: {
    id: 'smhi_oceanography', authority: 'SMHI', label: 'SMHI oceanografi (havsvattenstånd)',
    docsUrl: 'https://opendata.smhi.se/ocobs/api', access: 'public', commercialReuseReviewed: false,
    attributionText: 'Källa: SMHI', dataKind: 'observation', geographicPrecision: 'station',
    coverageNote: 'Nearest reporting sea-level station within 30 km, latest 3 h. Parameter 6: cm RH 2000, not relative to mean or building flood threshold. Hourly finite-difference trend (ADR 0004).',
    updatePolicy: 'Hourly station series, collected every 30 min for stations near properties', retentionPolicy: 'Latest station sample with one-hour trend',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_SMHI_OCEANOGRAPHY_ENABLED', reviewedAt: '2026-11-14',
  },
  krisinformation: {
    id: 'krisinformation', authority: 'MCF / Krisinformation.se', label: 'Krisinformation v3',
    docsUrl: 'https://www.krisinformation.se/om-krisinformation.se/oppen-data/', access: 'public', commercialReuseReviewed: false,
    attributionText: 'Källa: Krisinformation.se', dataKind: 'event', geographicPrecision: 'county',
    coverageNote: 'Area is often county-level; must be labelled regional information, not a local incident.',
    updatePolicy: 'Event-driven; news + VMA collected every 10 min', retentionPolicy: 'Active + 7 days after removal from the feed',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_KRISINFORMATION_ENABLED', reviewedAt: VERIFIED,
  },
  air_quality: {
    id: 'air_quality', authority: 'Naturvårdsverket / SMHI datavärd luft', label: 'Luftkvalitet',
    docsUrl: 'https://www.naturvardsverket.se/amnesomraden/luft/statistik--utslapp-och-halter/luftkvaliteten-i-realtid-och-preliminar-statistik/webbtjanster-luftkvalitetsdata/',
    access: 'public', commercialReuseReviewed: false, attributionText: 'Källa: Naturvårdsverket / SMHI', dataKind: 'observation',
    geographicPrecision: 'station', coverageNote: 'Preliminary station observations ≤25 km. EEA hourly station index (ADR 0005), minimum same-hour pollutants required; never a building index.',
    updatePolicy: 'Hourly where reported; 5 pollutants collected sequentially every 60 min', retentionPolicy: 'Latest samples + 7 days of hourly inputs for station index (no gap filling)',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_AIR_QUALITY_ENABLED', reviewedAt: '2026-11-14',
  },
  sgu_groundwater: {
    id: 'sgu_groundwater', authority: 'SGU', label: 'SGU grundvatten',
    docsUrl: 'https://www.sgu.se/produkter-och-tjanster/geologiska-data/grundvatten--geologiska-data/grundvattennivaer/',
    access: 'public', commercialReuseReviewed: false, attributionText: 'Källa: SGU', dataKind: 'model', geographicPrecision: 'mixed',
    coverageNote: 'Regional 4×4 km HYPE model must not be presented as a basement measurement.',
    updatePolicy: 'HYPE model daily values, published with a few days lag; collected every 12 h', retentionPolicy: 'Latest value per property area',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_SGU_ENABLED', reviewedAt: '2026-11-14',
  },
  mcf_flood: {
    id: 'mcf_flood', authority: 'MCF Översvämningsportalen', label: 'MCF översvämningskartering',
    docsUrl: 'https://www.mcf.se/sv/verktyg--tjanster/oversvamningsportalen/', access: 'public', commercialReuseReviewed: false,
    attributionText: 'Källa: MCF Översvämningsportalen', dataKind: 'static', geographicPrecision: 'polygon',
    coverageNote: 'Static scenarios (e.g. 100-year flow), never a current water level. Layers must be inventoried per region.',
    updatePolicy: 'Static dataset (version 20260909); each property re-checked weekly and when its pin moves', retentionPolicy: 'Latest result per property',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'MCF_FLOOD_ENABLED', reviewedAt: VERIFIED,
  },
  sgu_observed_groundwater: {
    id: 'sgu_observed_groundwater', authority: 'SGU', label: 'SGU uppmätt grundvatten',
    docsUrl: 'https://api.sgu.se/oppnadata/grundvattennivaer-observerade/ogc/features/v1',
    access: 'public', commercialReuseReviewed: false, attributionText: 'Källa: SGU (CC0)', dataKind: 'observation', geographicPrecision: 'station',
    coverageNote: 'Nearest station within 10 km with an unremarked measurement in the last 31 days; m below station ground, not building basement. ADR 0004.',
    updatePolicy: 'Daily collection per property; measurement dates vary by station', retentionPolicy: 'Latest matched station per property',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_SGU_OBSERVED_ENABLED', reviewedAt: '2026-11-14',
  },
  sl_deviations: {
    id: 'sl_deviations', authority: 'SL / Trafiklab', label: 'SL båttrafik (avstängd)',
    docsUrl: 'https://www.trafiklab.se/api/other-apis/sl/deviations/',
    access: 'public', commercialReuseReviewed: false, attributionText: 'Källa: SL via Trafiklab', dataKind: 'event', geographicPrecision: 'mixed',
    coverageNote: 'SHIP/FERRY messages with named stop areas matched to SL site coordinates ≤2 km. Line-only messages cannot be assigned a distance and are skipped. API itself needs no key; separate local opt-in key gate retained as requested.',
    updatePolicy: 'Every 5 min when enabled; sites once per run (no page-view fetches)', retentionPolicy: 'Active + 7 days',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: ['SL_DEVIATIONS_API_KEY'], enableFlag: 'SOURCE_SL_DEVIATIONS_ENABLED', reviewedAt: '2026-11-14',
  },
  scb: {
    id: 'scb', authority: 'SCB', label: 'SCB PxWebApi v2',
    docsUrl: 'https://www.scb.se/vara-tjanster/oppna-data/pxwebapi/pxwebapi-v2/', access: 'public', commercialReuseReviewed: false,
    attributionText: 'Källa: SCB', dataKind: 'statistics', geographicPrecision: 'municipality',
    coverageNote: 'Context only; 30 calls/10 s per IP, max 150 000 cells per request.',
    updatePolicy: 'Annual publication (TAB628); re-checked every 7 days', retentionPolicy: 'Latest period per property municipality',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: [], enableFlag: 'SOURCE_SCB_ENABLED', reviewedAt: VERIFIED,
  },
  trafikverket: {
    id: 'trafikverket', authority: 'Trafikverket', label: 'Trafikverket öppna API',
    docsUrl: 'https://data.trafikverket.se/get-started', access: 'requires_key', commercialReuseReviewed: false,
    licenseUrl: 'https://www.trafikverket.se/e-tjanster/trafikverkets-oppna-api-for-trafikinformation/',
    attributionText: 'Källa: Trafikverket (CC0)', dataKind: 'event', geographicPrecision: 'mixed',
    coverageNote: 'Road events and road-ferry disruptions within 2 km; ordinary ferry departures excluded. SL commuter boats use a separate gated source. Nearby event ≠ blocked access to the building.',
    updatePolicy: 'Situations queried within 2 km of each property every 5 min (≤ 20 points per request)', retentionPolicy: 'Active + 7 days after end',
    displayPermitted: false, alertsPermitted: false, requiredSecrets: ['TRAFIKVERKET_API_KEY'], enableFlag: 'TRAFIKVERKET_ENABLED', reviewedAt: '2026-11-14',
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
