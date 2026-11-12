import type { ServerEnv } from '@fastighetsradar/config';
import type { DataSourceStatus, SourceRuntimeStatus } from '@fastighetsradar/domain';
import { MANIFEST_LIST, type SourceManifest } from './sources/manifest';
import { ADAPTER_IMPLEMENTATION } from './registry';

/**
 * Computes each source's configuration status from env + manifest WITHOUT calling
 * any external API. Runtime health (last success, errors) is added by collectors later.
 *
 * Precedence: disabled flag → missing credentials → adapter not implemented → configured.
 * A source is never reported `ok` here: `ok` requires a successful real fetch.
 */
export function resolveSourceStatus(manifest: SourceManifest, env: ServerEnv): DataSourceStatus {
  const flagEnabled = manifest.enableFlag ? Boolean(env[manifest.enableFlag as keyof ServerEnv]) : true;
  const missingSecrets = manifest.requiredSecrets.filter((k) => !env[k as keyof ServerEnv]);

  let status: SourceRuntimeStatus;
  let note: string;
  if (manifest.access === 'disabled' && !flagEnabled) {
    status = 'disabled';
    note = 'Disabled pending legal/usage clearance';
  } else if (!flagEnabled) {
    status = 'disabled';
    note = `Disabled via ${manifest.enableFlag}`;
  } else if (missingSecrets.length > 0) {
    status = manifest.access === 'requires_approval' ? 'access_required' : 'pending_access';
    note = `Missing ${missingSecrets.join(', ')}`;
  } else if (ADAPTER_IMPLEMENTATION[manifest.id] !== 'implemented') {
    status = 'not_implemented';
    note = 'Adapter not implemented yet';
  } else {
    // Configured, but health is unknown until a collector run succeeds.
    status = 'degraded';
    note = 'Configured – awaiting first successful fetch';
  }

  return {
    sourceId: manifest.id,
    label: manifest.label,
    status,
    lastSuccessAt: null,
    lastCheckedAt: null,
    freshness: 'unknown',
    errorCode: null,
    note,
  };
}

export function resolveSourceStatuses(env: ServerEnv): DataSourceStatus[] {
  return MANIFEST_LIST.map((m) => resolveSourceStatus(m, env));
}
