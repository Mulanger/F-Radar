import { PROPERTY_GROUPS_MAX, propertyGroupKey, type PropertyGroup } from '@fastighetsradar/domain';
import type { Queryable } from './migrations';
import type { OrgContext } from './properties';

/**
 * Property groups (docs/plans/skalning.md, Fas 4 / S-20). Tenant-scoped like `properties.ts`: every
 * statement filters on the internal organization id, and the composite foreign keys of
 * property_group_members make a membership across organizations impossible.
 */

type Org = Pick<OrgContext, 'organizationId'>;
const UNIQUE_VIOLATION = '23505';
const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === UNIQUE_VIOLATION;

export async function listPropertyGroups(db: Queryable, ctx: Org): Promise<PropertyGroup[]> {
  const { rows } = await db.query<{ id: string; name: string; n: number }>(
    `SELECT g.id, g.name,
            (SELECT count(*)::int FROM property_group_members m WHERE m.group_id = g.id) AS n
       FROM property_groups g
      WHERE g.organization_id = $1
      ORDER BY lower(g.name), g.id`,
    [ctx.organizationId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, propertyCount: Number(r.n) }));
}

export type CreateGroupResult = { ok: true; group: PropertyGroup } | { ok: false; reason: 'duplicate' | 'limit' };

/** Creates a group (and its first members). A name the organization already uses is `duplicate`. */
export async function createPropertyGroup(db: Queryable, ctx: OrgContext, name: string, propertyIds: string[] = []): Promise<CreateGroupResult> {
  const { rows } = await db.query<{ id: string; name: string; n: number }>(
    `WITH ins AS (
       INSERT INTO property_groups (organization_id, name, created_by)
       SELECT $1, $2, $3
        WHERE (SELECT count(*) FROM property_groups WHERE organization_id = $1) < $4
       ON CONFLICT (organization_id, lower(btrim(name))) DO NOTHING
       RETURNING id, name, organization_id
     ), members AS (
       INSERT INTO property_group_members (organization_id, group_id, property_id)
       SELECT ins.organization_id, ins.id, p.id FROM ins JOIN properties p ON p.organization_id = ins.organization_id AND p.id = ANY($5::uuid[])
       RETURNING 1
     )
     SELECT id, name, (SELECT count(*)::int FROM members) AS n FROM ins`,
    [ctx.organizationId, name.trim(), ctx.userId, PROPERTY_GROUPS_MAX, propertyIds],
  );
  if (rows[0]) return { ok: true, group: { id: rows[0].id, name: rows[0].name, propertyCount: Number(rows[0].n) } };
  const { rows: same } = await db.query('SELECT 1 FROM property_groups WHERE organization_id = $1 AND lower(btrim(name)) = lower(btrim($2))', [
    ctx.organizationId,
    name,
  ]);
  return { ok: false, reason: same.length ? 'duplicate' : 'limit' };
}

export async function renamePropertyGroup(db: Queryable, ctx: OrgContext, id: string, name: string): Promise<'ok' | 'not_found' | 'duplicate'> {
  try {
    const res = (await db.query('UPDATE property_groups SET name = $3, updated_at = now() WHERE organization_id = $1 AND id = $2', [
      ctx.organizationId,
      id,
      name.trim(),
    ])) as { rowCount?: number | null };
    return (res.rowCount ?? 0) > 0 ? 'ok' : 'not_found';
  } catch (err) {
    if (isUniqueViolation(err)) return 'duplicate';
    throw err;
  }
}

/** Deletes the group; its properties stay. */
export async function deletePropertyGroup(db: Queryable, ctx: Org, id: string): Promise<boolean> {
  const res = (await db.query('DELETE FROM property_groups WHERE organization_id = $1 AND id = $2', [ctx.organizationId, id])) as {
    rowCount?: number | null;
  };
  return (res.rowCount ?? 0) > 0;
}

/**
 * Replaces the group's members in one statement. Ids that are not the organization's properties (any
 * more) are skipped. Returns the member count, or null when the group does not exist.
 */
export async function setPropertyGroupMembers(db: Queryable, ctx: Org, id: string, propertyIds: string[]): Promise<number | null> {
  const { rows } = await db.query<{ found: number; n: number }>(
    `WITH g AS (
       SELECT id, organization_id FROM property_groups WHERE organization_id = $1 AND id = $2
     ), wanted AS (
       SELECT p.id FROM properties p, g WHERE p.organization_id = g.organization_id AND p.id = ANY($3::uuid[])
     ), removed AS (
       DELETE FROM property_group_members m USING g
        WHERE m.group_id = g.id AND m.property_id NOT IN (SELECT id FROM wanted)
       RETURNING 1
     ), added AS (
       INSERT INTO property_group_members (organization_id, group_id, property_id)
       SELECT g.organization_id, g.id, wanted.id FROM g, wanted
       ON CONFLICT (group_id, property_id) DO NOTHING
       RETURNING 1
     ), touched AS (
       UPDATE property_groups SET updated_at = now() FROM g WHERE property_groups.id = g.id RETURNING 1
     )
     SELECT (SELECT count(*)::int FROM g) AS found, (SELECT count(*)::int FROM wanted) AS n`,
    [ctx.organizationId, id, propertyIds],
  );
  return rows[0]?.found ? Number(rows[0].n) : null;
}

/**
 * The groups an import's rows name (S-28 × S-20): existing ones by name (case does not matter), the
 * rest created while the organization is under `PROPERTY_GROUPS_MAX`. Returns name key → group id;
 * a name missing from the map could not be created (the limit).
 */
export async function ensurePropertyGroups(db: Queryable, ctx: OrgContext, names: string[]): Promise<Map<string, string>> {
  const wanted = new Map<string, string>();
  for (const name of names) if (name.trim()) wanted.set(propertyGroupKey(name), name.trim());
  const byKey = new Map<string, string>();
  if (!wanted.size) return byKey;
  const existing = await listPropertyGroups(db, ctx);
  for (const g of existing) byKey.set(propertyGroupKey(g.name), g.id);
  for (const [key, name] of wanted) {
    if (byKey.has(key)) continue;
    const created = await createPropertyGroup(db, ctx, name);
    if (created.ok) byKey.set(key, created.group.id);
    else if (created.reason === 'duplicate') {
      // Created by a parallel request in the meantime.
      const again = (await listPropertyGroups(db, ctx)).find((g) => propertyGroupKey(g.name) === key);
      if (again) byKey.set(key, again.id);
    }
  }
  return byKey;
}
