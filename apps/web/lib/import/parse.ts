import { importAddressKey, PROPERTY_GROUP_NAME_MAX, PROPERTY_IMPORT_ROWS_MAX, SWEDEN_BOUNDS, type PropertyImportRow } from '@fastighetsradar/domain';

/**
 * Reads the customer's property list for the import (docs/plans/skalning.md, Fas 6 / S-28): rows
 * pasted from Excel (tab-separated) or a CSV file (semicolon or comma), with or without a header row.
 * Everything here runs in the browser; the API validates the rows again.
 */

export type ColumnRole = 'name' | 'address' | 'postcode' | 'city' | 'lat' | 'lon' | 'group' | 'ignore';

export const COLUMN_ROLE_LABELS: Record<ColumnRole, string> = {
  name: 'Namn',
  address: 'Adress',
  postcode: 'Postnummer',
  city: 'Ort',
  lat: 'Latitud',
  lon: 'Longitud',
  group: 'Grupp',
  ignore: 'Används inte',
};

const HEADER_WORDS: Record<Exclude<ColumnRole, 'ignore'>, string[]> = {
  name: ['namn', 'fastighet', 'fastighetsnamn', 'benämning', 'objekt', 'objektnamn', 'byggnad', 'name', 'property'],
  address: ['adress', 'gatuadress', 'besöksadress', 'fastighetsadress', 'address', 'street', 'gata'],
  postcode: ['postnummer', 'postnr', 'postkod', 'zip', 'postalcode', 'postcode'],
  city: ['ort', 'postort', 'stad', 'city', 'town'],
  lat: ['latitud', 'lat', 'latitude', 'breddgrad'],
  lon: ['longitud', 'lon', 'lng', 'long', 'longitude', 'längdgrad'],
  // The organization's own grouping (Fas 4 / S-20): area, company or manager.
  group: ['grupp', 'gruppnamn', 'group', 'fastighetsgrupp'],
};

const headerWord = (cell: string) => cell.toLocaleLowerCase('sv-SE').replace(/[^\p{L}]/gu, '');

function roleOfHeader(cell: string): ColumnRole | null {
  const word = headerWord(cell);
  if (!word) return null;
  for (const [role, words] of Object.entries(HEADER_WORDS) as Array<[Exclude<ColumnRole, 'ignore'>, string[]]>) {
    if (words.includes(word)) return role;
  }
  return null;
}

export interface ImportTable {
  /** Header row, or null when the first row is data. */
  header: string[] | null;
  rows: string[][];
  /** Spreadsheet row number of rows[0] (2 after a header row). */
  firstRowNumber: number;
  columns: number;
  delimiter: '\t' | ';' | ',';
}

/** Counts a character outside quotes on the first non-empty line. */
function countOutsideQuotes(line: string, ch: string): number {
  let n = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === ch && !quoted) n++;
  }
  return n;
}

function detectDelimiter(text: string): ImportTable['delimiter'] {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  if (countOutsideQuotes(first, '\t') > 0) return '\t';
  // Swedish Excel saves CSV with semicolons (comma is the decimal separator).
  return countOutsideQuotes(first, ';') >= countOutsideQuotes(first, ',') && countOutsideQuotes(first, ';') > 0 ? ';' : ',';
}

/** RFC 4180-style split: quoted fields may hold the delimiter, line breaks and doubled quotes. */
export function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export class ImportParseError extends Error {}

export function parseImportText(raw: string): ImportTable {
  const text = raw.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);
  const all = splitDelimited(text, delimiter)
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''));
  if (!all.length) throw new ImportParseError('Hittade inga rader.');
  const first = all[0]!;
  const hasHeader = first.some((c) => roleOfHeader(c) !== null);
  const rows = hasHeader ? all.slice(1) : all;
  if (rows.length > PROPERTY_IMPORT_ROWS_MAX) {
    throw new ImportParseError(`Filen har ${rows.length.toLocaleString('sv-SE')} rader – högst ${PROPERTY_IMPORT_ROWS_MAX.toLocaleString('sv-SE')} går att importera åt gången.`);
  }
  const columns = Math.max(...all.map((r) => r.length));
  return { header: hasHeader ? first : null, rows, firstRowNumber: hasHeader ? 2 : 1, columns, delimiter };
}

const looksNumeric = (v: string) => /^-?\d{1,3}([.,]\d+)?$/.test(v.trim());

/** Column roles from the header, or by position when there is none. */
export function detectColumns(table: ImportTable): ColumnRole[] {
  const roles: ColumnRole[] = Array.from({ length: table.columns }, () => 'ignore');
  if (table.header) {
    const used = new Set<ColumnRole>();
    table.header.forEach((cell, i) => {
      const role = roleOfHeader(cell);
      if (role && !used.has(role)) {
        roles[i] = role;
        used.add(role);
      }
    });
    // "Kommun" stands in for the town only when there is no "Ort" column.
    const kommun = table.header.findIndex((cell) => headerWord(cell) === 'kommun');
    if (kommun >= 0 && !used.has('city') && roles[kommun] === 'ignore') roles[kommun] = 'city';
    return roles;
  }
  if (table.columns === 1) return ['address'];
  roles[0] = 'name';
  roles[1] = 'address';
  // name, address, lat, lon – or name, address, postcode, town.
  const sample = table.rows.slice(0, 20);
  for (let i = 2; i < table.columns; i++) {
    const numeric = sample.filter((r) => r[i] && looksNumeric(r[i]!)).length > sample.length / 2;
    if (numeric && !roles.includes('lat')) roles[i] = 'lat';
    else if (numeric && !roles.includes('lon')) roles[i] = 'lon';
    else if (!numeric && sample.some((r) => /^\d{3} ?\d{2}$/.test(r[i] ?? '')) && !roles.includes('postcode')) roles[i] = 'postcode';
    else if (!numeric && !roles.includes('city')) roles[i] = 'city';
  }
  return roles;
}

export type PreviewStatus = 'ready' | 'invalid' | 'duplicate_file' | 'exists';

export interface PreviewRow {
  /** Spreadsheet row number, as the customer sees it in Excel. */
  row: number;
  name: string;
  address: string;
  location?: { lat: number; lon: number };
  /** The group to put the property in (created on import when the organization has none by that name). */
  group?: string;
  status: PreviewStatus;
  /** Why the row cannot be imported. */
  message?: string;
  /** Importable, but the hit may be uncertain. */
  warning?: string;
}

const coordinate = (v: string | undefined): number | null => {
  if (!v || !v.trim()) return null;
  const n = Number(v.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

const inSweden = (lat: number, lon: number) =>
  lat >= SWEDEN_BOUNDS.minLat && lat <= SWEDEN_BOUNDS.maxLat && lon >= SWEDEN_BOUNDS.minLon && lon <= SWEDEN_BOUNDS.maxLon;

/** Joins address, postcode and town without repeating what the address already says. */
function fullAddress(address: string, postcode: string, city: string): string {
  const lower = address.toLocaleLowerCase('sv-SE');
  const pc = postcode && !lower.replace(/\s/g, '').includes(postcode.replace(/\s/g, '')) ? postcode : '';
  const town = city && !lower.includes(city.toLocaleLowerCase('sv-SE')) ? city : '';
  const tail = [pc, town].filter(Boolean).join(' ');
  return address && tail ? `${address}, ${tail}` : address || tail;
}

/**
 * The rows to import with a status each: missing or broken values, a repeat of an earlier row,
 * or an address the organization already has (`existingAddresses`: addresses and search labels).
 */
export function buildPreview(table: ImportTable, roles: ColumnRole[], existingAddresses: Iterable<string>): PreviewRow[] {
  const existing = new Set<string>();
  for (const a of existingAddresses) existing.add(importAddressKey(a));
  const col = (role: ColumnRole) => roles.indexOf(role);
  const [iName, iAddress, iPostcode, iCity, iLat, iLon, iGroup] = (['name', 'address', 'postcode', 'city', 'lat', 'lon', 'group'] as const).map(col);
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const seen = new Map<string, number>();

  return table.rows.map((r, index): PreviewRow => {
    const row = table.firstRowNumber + index;
    const postcode = cell(r, iPostcode!);
    const city = cell(r, iCity!);
    const address = fullAddress(cell(r, iAddress!), postcode, city);
    const name = cell(r, iName!) || address.split(',')[0]!.trim();
    const lat = coordinate(cell(r, iLat!));
    const lon = coordinate(cell(r, iLon!));
    const group = cell(r, iGroup!).replace(/\s+/g, ' ');
    const base = { row, name, address, ...(group && { group }) };

    if (address.length < 3) return { ...base, status: 'invalid', message: 'Adress saknas' };
    if (name.length > 120) return { ...base, status: 'invalid', message: 'Namnet är längre än 120 tecken' };
    if (address.length > 300) return { ...base, status: 'invalid', message: 'Adressen är längre än 300 tecken' };
    if (group.length > PROPERTY_GROUP_NAME_MAX) return { ...base, status: 'invalid', message: `Gruppnamnet är längre än ${PROPERTY_GROUP_NAME_MAX} tecken` };
    let location: PreviewRow['location'];
    if (lat !== null || lon !== null) {
      if (lat === null || lon === null) return { ...base, status: 'invalid', message: 'Både latitud och longitud behövs' };
      if (Number.isNaN(lat) || Number.isNaN(lon)) return { ...base, status: 'invalid', message: 'Koordinaterna är inte tal' };
      if (!inSweden(lat, lon)) return { ...base, status: 'invalid', message: 'Koordinaterna ligger utanför Sverige (ange WGS84, t.ex. 59,3293 och 18,0686)' };
      location = { lat, lon };
    }
    const key = importAddressKey(address);
    const earlier = seen.get(key);
    if (earlier !== undefined) return { ...base, location, status: 'duplicate_file', message: `Samma adress som rad ${earlier}` };
    seen.set(key, row);
    if (existing.has(key)) return { ...base, location, status: 'exists', message: 'Finns redan som fastighet' };
    const hasTown = /,/.test(address) || /\b\d{3} ?\d{2}\b/.test(address);
    return {
      ...base,
      location,
      status: 'ready',
      ...(!location && !hasTown && { warning: 'Ort saknas – adressen kan hamna i fel ort' }),
    };
  });
}

/** The rows the API gets: only those ready to import. */
export function importRows(preview: PreviewRow[]): PropertyImportRow[] {
  return preview
    .filter((p) => p.status === 'ready')
    .map((p) => ({ row: p.row, name: p.name, address: p.address, ...(p.location && { location: p.location }), ...(p.group && { group: p.group }) }));
}
