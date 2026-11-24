import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { radarCoordinates, radarFile, renderRadar } from '@/lib/server/portfolio-radar';

describe('SMHI portfolio radar', () => {
  it('uses a dated PNG that matches the observation time and discards old frames', () => {
    const payload = { lastFiles: [
      { key: 'radar_sweden_comp_202611241530', valid: '2026-11-24 15:30', formats: [{ key: 'h5' }] },
      { key: 'radar_2611241530', valid: '2026-11-24 15:30', formats: [{ key: 'png', link: 'ignored' }] },
    ] };
    expect(radarFile(payload, Date.parse('2026-11-24T15:35:00Z'))).toEqual({
      measuredAt: '2026-11-24T15:30:00Z',
      path: '2026/11/24/radar_2611241530.png',
    });
    expect(radarFile(payload, Date.parse('2026-11-24T15:50:00Z'))).toBeNull();
  });

  it('georeferences the radar and renders blue precipitation with grey or absent data transparent', async () => {
    // Published SWEREF 99 TM control point from Lantmäteriet (59° N, 19° 30′ E).
    const point = radarCoordinates(59, 19.5);
    expect(point.north).toBeCloseTo(6548757.206, 2);
    expect(point.east).toBeCloseTo(758410.519, 2);

    const width = 471;
    const height = 887;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([130, 130, 130, 255], i);
    for (let y = 584; y < 601; y++) {
      for (let x = 265; x < 280; x++) pixels.set([0, 160, 0, 255], 4 * (y * width + x));
    }
    const input = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const { data, info } = await sharp(await renderRadar(new Uint8Array(input).buffer)).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    const mercator = (lat: number) => Math.asinh(Math.tan(lat * Math.PI / 180));
    const x = Math.floor((18.05825 - 7) / (32 - 7) * info.width);
    const y = Math.floor((mercator(71) - mercator(59.3195)) / (mercator(71) - mercator(53)) * info.height);
    const center = 4 * (y * info.width + x);
    expect([...data.subarray(center, center + 4)]).toEqual([48, 112, 198, 135]);
    expect(data[center + 60 * 4 + 3]).toBe(0);
  });
});
