/**
 * Map tile provider configuration – the single place that decides which raster tiles
 * every Leaflet map uses (portfolio map, local context map, location picker).
 *
 * Provider: Geoapify Maps (https://apidocs.geoapify.com/docs/maps/).
 *  - The browser uses a SEPARATE, origin-restricted key (`NEXT_PUBLIC_GEOAPIFY_MAP_KEY`).
 *    The server geocoding key (`GEOAPIFY_API_KEY`) is never sent to the browser.
 *  - Each tile request costs 0.25 credits (free plan: 3 000 credits/day, shared with geocoding).
 *  - Attribution on the free plan: "Powered by Geoapify", "© OpenMapTiles" (all styles except
 *    osm-carto) and "© OpenStreetMap contributors".
 *
 * The module is pure (no Leaflet, no window) so it can be unit-tested; values come in as
 * arguments because NEXT_PUBLIC_* variables must be referenced literally to be inlined.
 */

/** Light Geoapify raster styles suitable for the dashboard's Scandinavian look. */
export const GEOAPIFY_LIGHT_STYLES = ['positron', 'osm-bright-grey', 'osm-bright-smooth', 'osm-bright', 'klokantech-basic', 'toner-grey', 'osm-liberty'] as const;
export type GeoapifyStyle = (typeof GEOAPIFY_LIGHT_STYLES)[number];
// Positron is the OpenMapTiles rendition of CARTO's light basemap used by the approved prototype –
// the closest visual match (muted greys, no road shields). osm-bright-grey stays selectable.
export const DEFAULT_GEOAPIFY_STYLE: GeoapifyStyle = 'positron';

export const GEOAPIFY_ATTRIBUTION =
  'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a>' +
  ' | © <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a>' +
  ' © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

/** Zoom limits: Sweden-scale overview to building level (Geoapify serves up to z20). */
export const MAP_MIN_ZOOM = 4;
export const MAP_MAX_ZOOM = 19;

export type TileConfig =
  | {
      provider: 'geoapify' | 'custom';
      /** Leaflet URL template; `{r}` becomes `@2x` on high-DPI screens. */
      url: string;
      attribution: string;
      style: string | null;
      minZoom: number;
      maxZoom: number;
    }
  | {
      provider: 'none';
      reason: 'missing_key' | 'invalid_key' | 'server_key_reused';
      /** Shown in the attribution corner instead of tiles – markers and overlays keep working. */
      attribution: string;
      minZoom: number;
      maxZoom: number;
    };

export interface TileEnv {
  geoapifyMapKey?: string;
  style?: string;
  /** Escape hatch for another provider later (template + attribution). */
  customUrl?: string;
  customAttribution?: string;
}

/** Geoapify keys are 32 hex characters. */
export const isPlausibleGeoapifyKey = (k: string) => /^[a-f0-9]{32}$/i.test(k);

export function geoapifyTileUrl(style: string, key: string): string {
  return `https://maps.geoapify.com/v1/tile/${encodeURIComponent(style)}/{z}/{x}/{y}{r}.png?apiKey=${encodeURIComponent(key)}`;
}

export function resolveTileConfig(env: TileEnv): TileConfig {
  const zoom = { minZoom: MAP_MIN_ZOOM, maxZoom: MAP_MAX_ZOOM };
  const custom = env.customUrl?.trim();
  if (custom) {
    return { provider: 'custom', url: custom, attribution: env.customAttribution?.trim() || '© OpenStreetMap contributors', style: null, ...zoom };
  }
  const key = env.geoapifyMapKey?.trim();
  if (!key) return { provider: 'none', reason: 'missing_key', attribution: 'Map tiles not configured', ...zoom };
  if (!isPlausibleGeoapifyKey(key)) return { provider: 'none', reason: 'invalid_key', attribution: 'Map tiles not configured (invalid key)', ...zoom };
  const requested = env.style?.trim() as GeoapifyStyle | undefined;
  const style = requested && (GEOAPIFY_LIGHT_STYLES as readonly string[]).includes(requested) ? requested : DEFAULT_GEOAPIFY_STYLE;
  return { provider: 'geoapify', url: geoapifyTileUrl(style, key), attribution: GEOAPIFY_ATTRIBUTION, style, ...zoom };
}

/**
 * Client-side tile configuration. NEXT_PUBLIC_* values are inlined at build time.
 * `next.config.ts` refuses to build if the map key equals the server geocoding key.
 */
export const tileConfig: TileConfig = resolveTileConfig({
  geoapifyMapKey: process.env.NEXT_PUBLIC_GEOAPIFY_MAP_KEY,
  style: process.env.NEXT_PUBLIC_MAP_STYLE,
  customUrl: process.env.NEXT_PUBLIC_MAP_TILE_URL,
  customAttribution: process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION,
});

/** Tile errors after which we stop pretending tiles work (401/403/429 or network). */
export const TILE_ERROR_THRESHOLD = 6;
