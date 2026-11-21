import { LEGAL_VERSIONS } from '@fastighetsradar/domain';
import type { Queryable } from './migrations';

export interface LegalAcceptanceRecord {
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  privacyVersion: string | null;
  privacyAcceptedAt: string | null;
  acceptedByUserId: string | null;
}

interface Row {
  terms_version: string | null;
  terms_accepted_at: Date | null;
  privacy_version: string | null;
  privacy_accepted_at: Date | null;
  legal_accepted_by_user_id: string | null;
}

const COLUMNS = 'terms_version, terms_accepted_at, privacy_version, privacy_accepted_at, legal_accepted_by_user_id';
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

function toRecord(row: Row | undefined): LegalAcceptanceRecord {
  return {
    termsVersion: row?.terms_version ?? null,
    termsAcceptedAt: iso(row?.terms_accepted_at ?? null),
    privacyVersion: row?.privacy_version ?? null,
    privacyAcceptedAt: iso(row?.privacy_accepted_at ?? null),
    acceptedByUserId: row?.legal_accepted_by_user_id ?? null,
  };
}

export async function getLegalAcceptance(db: Queryable, organizationId: string): Promise<LegalAcceptanceRecord> {
  const { rows } = await db.query<Row>(`SELECT ${COLUMNS} FROM organizations WHERE id = $1`, [organizationId]);
  return toRecord(rows[0]);
}

/**
 * Records that `userId` accepted the current versions for the organization at `acceptedAt`.
 * An acceptance of the same versions that is already stored is kept (the first one counts).
 */
export async function recordLegalAcceptance(db: Queryable, organizationId: string, userId: string, acceptedAt: Date): Promise<LegalAcceptanceRecord> {
  const { rows } = await db.query<Row>(
    `UPDATE organizations
        SET terms_version = $2, terms_accepted_at = $4, privacy_version = $3, privacy_accepted_at = $4, legal_accepted_by_user_id = $5
      WHERE id = $1 AND (terms_version IS DISTINCT FROM $2 OR privacy_version IS DISTINCT FROM $3)
      RETURNING ${COLUMNS}`,
    [organizationId, LEGAL_VERSIONS.terms, LEGAL_VERSIONS.privacy, acceptedAt, userId],
  );
  return rows[0] ? toRecord(rows[0]) : getLegalAcceptance(db, organizationId);
}

export function acceptsCurrentVersions(record: LegalAcceptanceRecord): boolean {
  return record.termsVersion === LEGAL_VERSIONS.terms && record.privacyVersion === LEGAL_VERSIONS.privacy;
}
