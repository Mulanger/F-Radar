import { inflateRawSync } from 'node:zlib';

/**
 * Energimarknadsinspektionen – "Nätkoncession för område – lokalnät" (CC0 1.0, SWEREF 99 TM / EPSG:3006,
 * boundaries approximate; verified 2026-11-14 on
 * https://ei.se/bransch/koncessioner/ansokan-natkoncession-for-omrade/karttjanst-natkoncessioner-for-omrade).
 * A ZIP with an ESRI shapefile (Polygon, type 5) and a UTF-8 DBF with the concession holder
 * ("FöretagNa") and concession id ("KONCESSION").
 *
 * Minimal, dependency-free readers: ZIP (stored/deflate), SHP polygons, DBF text fields. Rings are kept
 * in SWEREF 99 TM; PostGIS builds polygons (ST_BuildArea) and transforms to WGS84.
 */
export const EI_LOCAL_CONCESSIONS_URL =
  'https://ei.se/download/18.4ec39e791a12f902c8eb95c/1792499100007/N%C3%A4tkoncession-f%C3%B6r-omr%C3%A5de-lokaln%C3%A4t.zip';
export const EI_ATTRIBUTION = 'Nätkoncessioner för område: Energimarknadsinspektionen (CC0), ungefärliga gränser';

/** Reads every file of a ZIP archive (central directory; stored or deflate). Throws on malformed input. */
export function readZip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: no end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('zip: bad local header');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compSize);
    if (method === 0) files.set(name, Buffer.from(data));
    else if (method === 8) files.set(name, inflateRawSync(data));
    else throw new Error(`zip: unsupported method ${method}`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** ESRI shapefile polygons (type 5): one entry per record, each a list of rings [[x, y], …]. Null shapes → null. */
export function readShpPolygons(shp: Buffer): Array<number[][][] | null> {
  if (shp.readInt32BE(0) !== 9994) throw new Error('shp: bad file code');
  const out: Array<number[][][] | null> = [];
  let p = 100;
  while (p + 8 <= shp.length) {
    const len = shp.readInt32BE(p + 4) * 2;
    const c = p + 8;
    const type = shp.readInt32LE(c);
    if (type === 0) out.push(null);
    else if (type === 5 || type === 15 || type === 25) {
      const numParts = shp.readInt32LE(c + 36);
      const numPoints = shp.readInt32LE(c + 40);
      const parts: number[] = [];
      for (let i = 0; i < numParts; i++) parts.push(shp.readInt32LE(c + 44 + i * 4));
      const pts = c + 44 + numParts * 4;
      const rings: number[][][] = [];
      for (let i = 0; i < numParts; i++) {
        const from = parts[i]!;
        const to = i + 1 < numParts ? parts[i + 1]! : numPoints;
        const ring: number[][] = [];
        for (let k = from; k < to; k++) ring.push([shp.readDoubleLE(pts + k * 16), shp.readDoubleLE(pts + k * 16 + 8)]);
        if (ring.length >= 4) rings.push(ring);
      }
      out.push(rings.length ? rings : null);
    } else throw new Error(`shp: unsupported shape type ${type}`);
    p = c + len;
  }
  return out;
}

/** DBF records as string maps (deleted records → null to keep alignment with the SHP). */
export function readDbf(dbf: Buffer): Array<Record<string, string> | null> {
  const n = dbf.readUInt32LE(4);
  const headerLen = dbf.readUInt16LE(8);
  const recordLen = dbf.readUInt16LE(10);
  const fields: Array<{ name: string; len: number }> = [];
  for (let o = 32; dbf[o] !== 0x0d && o < headerLen; o += 32) {
    fields.push({ name: dbf.toString('utf8', o, o + 11).replace(/\0.*$/s, ''), len: dbf[o + 16]! });
  }
  const out: Array<Record<string, string> | null> = [];
  for (let i = 0; i < n; i++) {
    let o = headerLen + i * recordLen;
    if (dbf[o] === 0x2a) {
      out.push(null);
      continue;
    }
    o += 1;
    const r: Record<string, string> = {};
    for (const f of fields) {
      r[f.name] = dbf.toString('utf8', o, o + f.len).trim();
      o += f.len;
    }
    out.push(r);
  }
  return out;
}

export interface EiConcessionArea {
  holder: string;
  concessionId: string | null;
  /** Rings in SWEREF 99 TM metres. */
  rings: number[][][];
}

/** Parses the Ei ZIP into concession areas. Field names are matched loosely ("FöretagNa" may be mis-encoded). */
export function parseEiConcessionZip(zip: Buffer): EiConcessionArea[] {
  const files = readZip(zip);
  const pick = (ext: string) => [...files.entries()].find(([k]) => k.toLowerCase().endsWith(ext))?.[1];
  const shp = pick('.shp');
  const dbf = pick('.dbf');
  if (!shp || !dbf) throw new Error('ei: shapefile parts missing');
  const shapes = readShpPolygons(shp);
  const rows = readDbf(dbf);
  if (shapes.length !== rows.length) throw new Error('ei: shp/dbf record count differ');
  const out: EiConcessionArea[] = [];
  for (let i = 0; i < shapes.length; i++) {
    const rings = shapes[i];
    const row = rows[i];
    if (!rings || !row) continue;
    const holderKey = Object.keys(row).find((k) => /^f.*retag/i.test(k)) ?? Object.keys(row)[0]!;
    const holder = row[holderKey]?.trim();
    if (!holder) continue;
    // SWEREF 99 TM sanity check (Sweden: E 180 000–1 000 000, N 6 100 000–7 700 000).
    const ok = rings.every((r) => r.every(([x, y]) => x! > 180_000 && x! < 1_000_000 && y! > 6_100_000 && y! < 7_700_000));
    if (!ok) continue;
    out.push({ holder, concessionId: row.KONCESSION?.trim() || null, rings });
  }
  return out;
}
