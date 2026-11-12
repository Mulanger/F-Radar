import type { GeocodeMetadata, PropertyCreateInput, PropertyRecord, PropertyUpdateInput } from '@fastighetsradar/domain';
import type { Queryable } from './migrations';

/**
 * Tenant-scoped property repository.
 *
 * Isolation rule: every function takes the INTERNAL organization id resolved from a
 * server-verified Clerk organization (see `ensureOrganization`), and every statement
 * filters on `organization_id`. No function accepts an organization id from a client.
 */

export interface OrgContext {
  /** Internal organizations.id (uuid). */
  organizationId: string;
  /** Verified Clerk user id (user_…), for audit columns. */
  userId: string;
}

/** Upserts the organization row for a verified Clerk organization and returns its internal id. */
export async function ensureOrganization(db: Queryable, clerkOrgId: string, displayName?: string | null): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO organizations (clerk_org_id, name)
     VALUES ($1, $2)
     ON CONFLICT (clerk_org_id) DO UPDATE
       SET name = COALESCE(EXCLUDED.name, organizations.name)
     RETURNING id`,
    [clerkOrgId, displayName ?? null],
  );
  return rows[0]!.id;
}

const SELECT_COLUMNS = `
  p.id, p.name, p.address, p.status, p.position_source,
  ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lon,
  p.geocode_provider, p.geocode_precision, p.geocode_confidence, p.geocode_label, p.geocode_place_id,
  p.geocode_result_type, p.postcode, p.city, p.municipality, p.geocoded_at, p.created_at, p.updated_at`;

interface Row {
  id: string;
  name: string;
  address: string;
  status: PropertyRecord['status'];
  position_source: PropertyRecord['positionSource'];
  lat: number;
  lon: number;
  geocode_provider: string;
  geocode_precision: string;
  geocode_confidence: string | number | null;
  geocode_label: string | null;
  geocode_place_id: string | null;
  geocode_result_type: string | null;
  postcode: string | null;
  city: string | null;
  municipality: string | null;
  geocoded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toRecord(r: Row): PropertyRecord {
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    location: { lat: Number(r.lat), lon: Number(r.lon) },
    positionSource: r.position_source,
    geocode: {
      provider: r.geocode_provider,
      precision: r.geocode_precision,
      confidence: r.geocode_confidence === null ? null : Number(r.geocode_confidence),
      label: r.geocode_label,
      placeId: r.geocode_place_id,
      resultType: r.geocode_result_type,
      postcode: r.postcode,
      city: r.city,
      municipality: r.municipality,
      geocodedAt: r.geocoded_at ? r.geocoded_at.toISOString() : null,
    },
    status: r.status,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

/** Decides how the confirmed point relates to the geocoder's point (≤ 2 m counts as unchanged). */
export function positionSourceFor(location: { lat: number; lon: number }, geocode: GeocodeMetadata): PropertyRecord['positionSource'] {
  if (geocode.provider === 'manual_pin' || !geocode.geocodedPoint) return 'manual_pin';
  const dLat = (location.lat - geocode.geocodedPoint.lat) * 111_320;
  const dLon = (location.lon - geocode.geocodedPoint.lon) * 111_320 * Math.cos((location.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon) <= 2 ? 'geocoded' : 'manual_adjusted';
}

const point = (lonParam: string, latParam: string) => `ST_SetSRID(ST_MakePoint(${lonParam}, ${latParam}), 4326)::geography`;

export async function listProperties(db: Queryable, ctx: Pick<OrgContext, 'organizationId'>): Promise<PropertyRecord[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${SELECT_COLUMNS} FROM properties p WHERE p.organization_id = $1 ORDER BY p.created_at, p.id`,
    [ctx.organizationId],
  );
  return rows.map(toRecord);
}

export async function getProperty(db: Queryable, ctx: Pick<OrgContext, 'organizationId'>, id: string): Promise<PropertyRecord | null> {
  const { rows } = await db.query<Row>(`SELECT ${SELECT_COLUMNS} FROM properties p WHERE p.organization_id = $1 AND p.id = $2`, [
    ctx.organizationId,
    id,
  ]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function createProperty(db: Queryable, ctx: OrgContext, input: PropertyCreateInput): Promise<PropertyRecord> {
  const g = input.geocode;
  const { rows } = await db.query<{ id: string }>(
    `WITH ins AS (
       INSERT INTO properties (
         organization_id, name, address, location, geocode_provider, geocode_precision, geocode_confidence,
         geocode_place_id, geocode_label, geocode_result_type, geocoded_location, geocoded_at, postcode, city,
         municipality, position_source, verified_at, created_by, updated_by
       ) VALUES (
         $1, $2, $3, ${point('$4', '$5')}, $6, $7, $8, $9, $10, $11,
         CASE WHEN $12::float8 IS NULL THEN NULL ELSE ${point('$13', '$12')} END,
         CASE WHEN $6 = 'geoapify' THEN now() ELSE NULL END, $14, $15, $16, $17, now(), $18, $18
       ) RETURNING id, organization_id
     ), mon AS (
       INSERT INTO property_monitoring (property_id, organization_id) SELECT id, organization_id FROM ins
     )
     SELECT id FROM ins`,
    [
      ctx.organizationId,
      input.name,
      input.address,
      input.location.lon,
      input.location.lat,
      g.provider,
      g.precision,
      g.confidence ?? null,
      g.placeId ?? null,
      g.label ?? null,
      g.resultType ?? null,
      g.geocodedPoint?.lat ?? null,
      g.geocodedPoint?.lon ?? null,
      g.postcode ?? null,
      g.city ?? null,
      g.municipality ?? null,
      positionSourceFor(input.location, g),
      ctx.userId,
    ],
  );
  return (await getProperty(db, ctx, rows[0]!.id))!;
}

/**
 * Updates name/address/location. Geocoding metadata is replaced only when a new geocode
 * selection is supplied (an address change through a fresh suggestion) – existing
 * properties are never re-geocoded implicitly.
 */
export async function updateProperty(db: Queryable, ctx: OrgContext, id: string, patch: PropertyUpdateInput): Promise<PropertyRecord | null> {
  const current = await getProperty(db, ctx, id);
  if (!current) return null;
  const sets: string[] = [];
  const params: unknown[] = [ctx.organizationId, id];
  const add = (sql: string, ...values: unknown[]) => {
    const start = params.length;
    values.forEach((v) => params.push(v));
    sets.push(sql.replace(/\$(\d+)/g, (_, n: string) => `$${start + Number(n)}`));
  };

  if (patch.name !== undefined) add('name = $1', patch.name);
  if (patch.address !== undefined) add('address = $1', patch.address);
  const g = patch.geocode;
  if (g) {
    add(
      `geocode_provider = $1, geocode_precision = $2, geocode_confidence = $3, geocode_place_id = $4, geocode_label = $5,
       geocode_result_type = $6, postcode = $7, city = $8, municipality = $9,
       geocoded_location = CASE WHEN $10::float8 IS NULL THEN NULL ELSE ${point('$11', '$10')} END,
       geocoded_at = CASE WHEN $1 = 'geoapify' THEN now() ELSE NULL END`,
      g.provider,
      g.precision,
      g.confidence ?? null,
      g.placeId ?? null,
      g.label ?? null,
      g.resultType ?? null,
      g.postcode ?? null,
      g.city ?? null,
      g.municipality ?? null,
      g.geocodedPoint?.lat ?? null,
      g.geocodedPoint?.lon ?? null,
    );
  }
  if (patch.location) {
    const source = g
      ? positionSourceFor(patch.location, g)
      : current.positionSource === 'manual_pin'
        ? 'manual_pin'
        : 'manual_adjusted';
    add(`location = ${point('$1', '$2')}, position_source = $3, verified_at = now()`, patch.location.lon, patch.location.lat, source);
  }
  add('updated_by = $1', ctx.userId);

  const { rowCount } = (await db.query(`UPDATE properties SET ${sets.join(', ')} WHERE organization_id = $1 AND id = $2`, params)) as {
    rowCount?: number | null;
  };
  if (rowCount === 0) return null;
  return getProperty(db, ctx, id);
}

export async function deleteProperty(db: Queryable, ctx: Pick<OrgContext, 'organizationId'>, id: string): Promise<boolean> {
  const res = (await db.query('DELETE FROM properties WHERE organization_id = $1 AND id = $2', [ctx.organizationId, id])) as {
    rowCount?: number | null;
  };
  return (res.rowCount ?? 0) > 0;
}
