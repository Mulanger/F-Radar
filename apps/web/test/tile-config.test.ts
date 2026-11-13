import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GEOAPIFY_STYLE,
  GEOAPIFY_ATTRIBUTION,
  MAP_MAX_ZOOM,
  geoapifyTileUrl,
  isPlausibleGeoapifyKey,
  resolveTileConfig,
} from '@/lib/maps/tile-config';

const KEY = '0123456789abcdef0123456789abcdef';

describe('map tile configuration', () => {
  it('builds Geoapify raster URLs with retina placeholder and the browser key', () => {
    expect(geoapifyTileUrl('osm-bright-grey', KEY)).toBe(`https://maps.geoapify.com/v1/tile/osm-bright-grey/{z}/{x}/{y}{r}.png?apiKey=${KEY}`);
  });

  it('defaults to positron (closest to the approved CARTO look) and accepts other light styles', () => {
    const def = resolveTileConfig({ geoapifyMapKey: KEY });
    expect(def).toMatchObject({ provider: 'geoapify', style: DEFAULT_GEOAPIFY_STYLE, maxZoom: MAP_MAX_ZOOM });
    expect(resolveTileConfig({ geoapifyMapKey: KEY, style: 'osm-bright-grey' })).toMatchObject({ style: 'osm-bright-grey' });
    // Unknown / dark styles fall back to the approved light default.
    expect(resolveTileConfig({ geoapifyMapKey: KEY, style: 'dark-matter' })).toMatchObject({ style: DEFAULT_GEOAPIFY_STYLE });
  });

  it('carries the attribution Geoapify requires on the free plan', () => {
    const cfg = resolveTileConfig({ geoapifyMapKey: KEY });
    expect(cfg.attribution).toBe(GEOAPIFY_ATTRIBUTION);
    expect(cfg.attribution).toContain('Powered by');
    expect(cfg.attribution).toContain('Geoapify');
    expect(cfg.attribution).toContain('OpenMapTiles');
    expect(cfg.attribution).toContain('OpenStreetMap');
  });

  it('degrades to "no tiles" (never CARTO, never a watermark) when the key is missing or malformed', () => {
    expect(resolveTileConfig({})).toMatchObject({ provider: 'none', reason: 'missing_key' });
    expect(resolveTileConfig({ geoapifyMapKey: '   ' })).toMatchObject({ provider: 'none', reason: 'missing_key' });
    expect(resolveTileConfig({ geoapifyMapKey: 'not-a-key' })).toMatchObject({ provider: 'none', reason: 'invalid_key' });
    for (const cfg of [resolveTileConfig({}), resolveTileConfig({ geoapifyMapKey: KEY })]) {
      expect(JSON.stringify(cfg)).not.toMatch(/carto/i);
    }
    expect(isPlausibleGeoapifyKey(KEY)).toBe(true);
  });

  it('allows swapping the provider later via a custom template', () => {
    expect(resolveTileConfig({ geoapifyMapKey: KEY, customUrl: 'https://tiles.example/{z}/{x}/{y}.png', customAttribution: '© Example' })).toMatchObject({
      provider: 'custom',
      url: 'https://tiles.example/{z}/{x}/{y}.png',
      attribution: '© Example',
    });
  });
});
