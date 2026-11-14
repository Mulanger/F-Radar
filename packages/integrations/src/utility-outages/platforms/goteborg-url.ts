/**
 * Göteborg Energi KML URLs. The JSON hands us a URL; we only accept it when it points at the
 * company's own outage KML handler (never follow an arbitrary host or path).
 */
const KML_PATH = '/GoteborgEnergi/Outages/FilteredOutagesKml.ashx';

export function goteborgKmlUrl(apiBase: string, listed: string | null, typeId: string, active: 0 | 1): string | null {
  const base = new URL(apiBase);
  if (listed) {
    let u: URL;
    try {
      u = new URL(listed, base);
    } catch {
      return null;
    }
    if (u.protocol !== 'https:' || u.host !== base.host || u.pathname !== KML_PATH || u.searchParams.get('type') !== typeId) return null;
    u.searchParams.set('active', String(active));
    return u.toString();
  }
  const u = new URL(KML_PATH, base);
  u.searchParams.set('type', typeId);
  u.searchParams.set('active', String(active));
  return u.toString();
}
