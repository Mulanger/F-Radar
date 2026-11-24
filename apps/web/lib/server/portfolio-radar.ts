import sharp from 'sharp';
import { RADAR_BOUNDS, RADAR_MAX_AGE_MS } from '@/lib/maps/portfolio-radar';

const SMHI_RADAR = 'https://opendata-download-radar.smhi.se/api/version/latest/area/sweden/product/comp';
const WIDTH = 640;
const HEIGHT = 980;
const SOURCE_WIDTH = 471;
const SOURCE_HEIGHT = 887;
// Upper-left corner and pixel spacing from the GeoTIFF published alongside the PNG.
const SOURCE_EAST = 126648.404;
const SOURCE_NORTH = 7771252.876;
const SOURCE_PIXEL_METRES = 2014.9581656;
const RAD = Math.PI / 180;

// Forward Gauss–Krüger projection (GRS80, SWEREF 99 TM). The output grid follows
// Leaflet's Web Mercator projection, so the radar aligns at every map zoom.
const flattening = 1 / 298.257222101;
const eccentricitySquared = flattening * (2 - flattening);
const n = flattening / (2 - flattening);
const scale = (0.9996 * 6378137 / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
const a = eccentricitySquared;
const b = (5 * a ** 2 - a ** 3) / 6;
const c = (104 * a ** 3 - 45 * a ** 4) / 120;
const d = 1237 * a ** 4 / 1260;
const beta = [
  n / 2 - 2 * n ** 2 / 3 + 5 * n ** 3 / 16 + 41 * n ** 4 / 180,
  13 * n ** 2 / 48 - 3 * n ** 3 / 5 + 557 * n ** 4 / 1440,
  61 * n ** 3 / 240 - 103 * n ** 4 / 140,
  49561 * n ** 4 / 161280,
];

export function radarCoordinates(lat: number, lon: number) {
  const phi = lat * RAD;
  const sinSquared = Math.sin(phi) ** 2;
  const conformal = phi - Math.sin(phi) * Math.cos(phi) * (a + sinSquared * (b + sinSquared * (c + sinSquared * d)));
  const longitude = (lon - 15) * RAD;
  const xi = Math.atan2(Math.tan(conformal), Math.cos(longitude));
  const eta = Math.atanh(Math.cos(conformal) * Math.sin(longitude));
  let north = xi;
  let east = eta;
  beta.forEach((coefficient, index) => {
    const factor = 2 * (index + 1);
    north += coefficient * Math.sin(factor * xi) * Math.cosh(factor * eta);
    east += coefficient * Math.cos(factor * xi) * Math.sinh(factor * eta);
  });
  return { north: scale * north, east: 500_000 + scale * east };
}

const mercator = (lat: number) => Math.asinh(Math.tan(lat * RAD));
let sourcePixels: Int32Array | undefined;

function buildSourcePixels() {
  const [[south, west], [north, east]] = RADAR_BOUNDS;
  const top = mercator(north);
  const span = top - mercator(south);
  const pixels = new Int32Array(WIDTH * HEIGHT).fill(-1);
  for (let y = 0; y < HEIGHT; y++) {
    const lat = Math.atan(Math.sinh(top - (y + 0.5) * span / HEIGHT)) / RAD;
    for (let x = 0; x < WIDTH; x++) {
      const lon = west + (x + 0.5) * (east - west) / WIDTH;
      const projected = radarCoordinates(lat, lon);
      const column = Math.floor((projected.east - SOURCE_EAST) / SOURCE_PIXEL_METRES);
      const row = Math.floor((SOURCE_NORTH - projected.north) / SOURCE_PIXEL_METRES);
      if (column >= 0 && column < SOURCE_WIDTH && row >= 0 && row < SOURCE_HEIGHT) {
        pixels[y * WIDTH + x] = 4 * (row * SOURCE_WIDTH + column);
      }
    }
  }
  return pixels;
}

export async function renderRadar(png: ArrayBuffer) {
  const { data, info } = await sharp(png, { limitInputPixels: SOURCE_WIDTH * SOURCE_HEIGHT })
    .toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== SOURCE_WIDTH || info.height !== SOURCE_HEIGHT) throw new Error('Unexpected SMHI radar dimensions');

  // SMHI's PNG draws precipitation in colour and map outlines/coverage in grey.
  // Replace the coloured pixels with one blue tone, preserving their real shapes.
  const echoes = new Uint8Array(data.length / 4);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (data[i + 3]! >= 128 && Math.max(r, g, b) - Math.min(r, g, b) >= 20) echoes[i / 4] = 135;
  }
  sourcePixels ??= buildSourcePixels();
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  sourcePixels.forEach((offset, index) => {
    if (offset < 0 || !echoes[offset / 4]) return;
    const output = index * 4;
    rgba[output] = 48;
    rgba[output + 1] = 112;
    rgba[output + 2] = 198;
    rgba[output + 3] = echoes[offset / 4]!;
  });
  return sharp(rgba, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png().toBuffer();
}

type Frame = { measuredAt: string; png: Buffer };
let frame: Frame | null = null;
let refreshAt = 0;
let pending: Promise<Frame | null> | null = null;

export function radarFile(payload: unknown, now: number) {
  const files = (payload as { lastFiles?: unknown } | null)?.lastFiles;
  if (!Array.isArray(files)) return null;
  for (const { key, valid, formats } of files.filter((file) => file && typeof file === 'object')) {
    if (typeof valid !== 'string' || !/^20\d\d-\d\d-\d\d \d\d:\d\d$/.test(valid)) continue;
    if (key !== `radar_${valid.slice(2).replace(/\D/g, '')}`) continue;
    if (!Array.isArray(formats) || !formats.some((format) => format?.key === 'png')) continue;
    const measuredAt = `${valid.replace(' ', 'T')}:00Z`;
    if (!fresh(measuredAt, now)) continue;
    return { measuredAt, path: `${valid.slice(0, 10).replaceAll('-', '/')}/${key}.png` };
  }
  return null;
}

function fresh(measuredAt: string, now: number) {
  const age = now - Date.parse(measuredAt);
  return age >= 0 && age < RADAR_MAX_AGE_MS;
}

async function fetchRadar() {
  const options = { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8_000) } as const;
  const metadata = await fetch(SMHI_RADAR, options);
  if (!metadata.ok) return null;
  const latest = radarFile(await metadata.json(), Date.now());
  if (!latest) return null;
  if (frame?.measuredAt === latest.measuredAt) return frame;
  const image = await fetch(`${SMHI_RADAR}/${latest.path}`, options);
  if (!image.ok || image.headers.get('content-type')?.split(';')[0] !== 'image/png') return null;
  return { measuredAt: latest.measuredAt, png: await renderRadar(await image.arrayBuffer()) };
}

export async function getRadarFrame() {
  const now = Date.now();
  if (now >= refreshAt && !pending) {
    pending = fetchRadar().catch(() => null).then((latest) => {
      if (latest && (!frame || latest.measuredAt >= frame.measuredAt)) frame = latest;
      refreshAt = Date.now() + (latest ? 60_000 : 30_000);
      pending = null;
      return frame;
    });
  }
  const latest = pending ? await pending : frame;
  return latest && fresh(latest.measuredAt, Date.now()) ? latest : null;
}
