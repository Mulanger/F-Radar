/**
 * Swedish local wall-clock times from outage maps ("2026-11-30 09:00", "2026-11-14 12.30")
 * → ISO-8601 UTC. DST-safe for Europe/Stockholm:
 *  - a time that does not exist (spring-forward gap) → null (never guessed);
 *  - an ambiguous time (autumn fall-back hour) → the FIRST occurrence (CEST), a defined result.
 */
const TZ = 'Europe/Stockholm';
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function localKey(ms: number): string {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export function stockholmLocalToIso(year: number, month: number, day: number, hour: number, minute: number): string | null {
  if (![year, month, day, hour, minute].every(Number.isInteger)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const wanted = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const hits = [120, 60].map((off) => naive - off * 60_000).filter((ms) => localKey(ms) === wanted);
  if (!hits.length) return null;
  return new Date(Math.min(...hits)).toISOString();
}

const LOCAL_RE = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*$/;

/** "2026-11-30 09:00" | "2026-11-14 12.30" | "2026-11-14 12:30:00" → ISO, else null. Empty → null. */
export function parseSwedishLocal(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = LOCAL_RE.exec(value);
  if (!m) return null;
  return stockholmLocalToIso(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!);
}

/** Local calendar date (YYYY-MM-DD) and clock of an ISO instant in Stockholm. */
export function stockholmParts(iso: string): { date: string; hour: number; minute: number } {
  const [date, clock] = localKey(Date.parse(iso)).split(' ');
  const [h, m] = clock!.split(':');
  return { date: date!, hour: +h!, minute: +m! };
}
