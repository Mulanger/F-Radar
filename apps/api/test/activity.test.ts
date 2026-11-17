import { describe, expect, it } from 'vitest';
import { PropertyActivitySchema } from '@fastighetsradar/domain';
import { listPropertyActivity, type Queryable } from '@fastighetsradar/db';

const ORG = '00000000-0000-4000-8000-00000000000a';
const PID = '11111111-1111-4111-8111-111111111111';
const at = (h: number) => new Date(Date.UTC(2026, 10, 17, h));

describe('property activity log', () => {
  it('scopes both reads to organization and property, merges newest first and caps the list', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db: Queryable = {
      async query<R>(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        if (sql.includes('FROM monitoring_changes')) {
          return { rows: [
            { id: '7', source_id: 'smhi_warnings', change_type: 'new', severity: 'monitor', headline: 'Vind', created_at: at(14), level: 'Yellow', attribution: 'Källa: SMHI' },
            { id: '3', source_id: 'utility_outages', change_type: 'ended', severity: 'info', headline: 'Strömmen är tillbaka enligt Ellevio', created_at: at(9), level: null, attribution: 'Ellevio' },
          ] as R[] };
        }
        return { rows: [{ id: 'a1', rule_name: 'Varningar', status: 'simulated', is_test: false, at: at(12), recipients: 2 }] as R[] };
      },
    };
    const items = await listPropertyActivity(db, ORG, PID, 7, 2);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.sql).toMatch(/organization_id = \$1 AND .*property_id = \$2/);
      expect(c.params.slice(0, 3)).toEqual([ORG, PID, 7]);
    }
    expect(items.map((i) => i.id)).toEqual(['c7', 'sa1']);
    expect(PropertyActivitySchema.parse({ propertyId: PID, since: at(0).toISOString(), items }).items[1]).toMatchObject({ kind: 'sms', recipients: 2 });
  });

  it('leaves regional news and traffic out of the timeline', async () => {
    let sql = '';
    const db: Queryable = { async query<R>(q: string) { if (q.includes('monitoring_changes')) sql = q; return { rows: [] as R[] }; } };
    await listPropertyActivity(db, ORG, PID);
    expect(sql).toContain("c.source_id = 'krisinformation' AND c.severity = 'critical'");
    expect(sql).not.toContain('trafikverket');
  });
});
