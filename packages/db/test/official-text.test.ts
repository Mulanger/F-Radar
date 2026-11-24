import { describe, expect, it } from 'vitest';
import { OFFICIAL_TEXT_LIMITS, SHORTENED_TEXT_MARKER, capOfficialText, listRecentChangesForOrg, loadOrgEvent, loadOrgMonitoring, type Queryable } from '../src';

describe('official text bounds', () => {
  it('stores realistic official texts unaltered', () => {
    const smhi = 'Vindbyar på 21–25 m/s längs kusten. Risk för nedfallna träd, lösa föremål och störd färjetrafik.';
    expect(capOfficialText(smhi, OFFICIAL_TEXT_LIMITS.description)).toBe(smhi);
    const exact = 'a'.repeat(OFFICIAL_TEXT_LIMITS.headline);
    expect(capOfficialText(exact, OFFICIAL_TEXT_LIMITS.headline)).toBe(exact);
  });

  it('bounds an abnormal payload and marks it visibly as shortened', () => {
    const capped = capOfficialText('x'.repeat(100_000), OFFICIAL_TEXT_LIMITS.description);
    expect(capped).toHaveLength(OFFICIAL_TEXT_LIMITS.description);
    expect(capped.endsWith(SHORTENED_TEXT_MARKER)).toBe(true);
  });
});

describe('warning-system test announcements', () => {
  it('excludes Krisinformation test news before limiting the feed and from event views', async () => {
    const queries: string[] = [];
    const db: Queryable = {
      async query<R>(sql: string) {
        queries.push(sql);
        return { rows: [] as R[] };
      },
    };

    await listRecentChangesForOrg(db, 'org', 30, 'viewer');
    await listRecentChangesForOrg(db, 'org', 30);
    await loadOrgMonitoring(db, 'org');
    await loadOrgEvent(db, 'org', 'event');

    const gate = (alias: string) => "NOT (" + alias + ".source_id = 'krisinformation' AND " + alias + ".data_class = 'PUBLIC_EVENT'";
    const [groupedFeed, recentChanges] = queries;
    expect(groupedFeed!.slice(0, groupedFeed!.indexOf('LIMIT $2'))).toContain(gate('c'));
    expect(recentChanges).toContain(gate('c'));
    expect(queries.find((sql) => sql.includes('SELECT m.property_id, m.match_method'))).toContain(gate('e'));
    expect(queries.find((sql) => sql.includes('FROM source_events e WHERE e.id = $2::uuid'))).toContain(gate('e'));
    expect(groupedFeed).toContain("^test av (nytt varningssystem|se[-– ]alert)");
  });
});
