export function assertDeploymentBranch(branch) {
  if (branch && !['codex/phase4-sms-notifications', 'codex/landing-parity-live'].includes(branch)) {
    throw new Error('Deployment requires an approved release branch or a detached checkout.');
  }
}

/** Preserve the running pod's configuration; local development credentials never replace it. */
export function deploymentEnvironment(current, local) {
  if (!current || Array.isArray(current) || typeof current !== 'object'
      || Object.values(current).some((v) => typeof v !== 'string')) {
    throw new Error('Cannot read the running pod environment.');
  }
  for (const key of ['APP_URL', 'CLERK_AUTHORIZED_PARTIES', 'CLERK_SECRET_KEY',
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'DATABASE_URL']) {
    if (!current[key]) throw new Error(`Running pod is missing ${key}.`);
  }
  if (current.SMS_ENABLED !== 'false' || current.SMS_PROVIDER !== 'simulated'
      || current.SMS_DRY_RUN !== 'true' || current.SMS_LIVE_SENDING_APPROVED !== 'false') {
    throw new Error('This release requires the running SMS configuration to remain simulated.');
  }
  const vars = { ...current };
  // These are the only intentional source configuration changes in this release.
  for (const key of ['MET_NORWAY_CONTACT', 'SOURCE_MET_NOWCAST_ENABLED', 'SOURCE_SGU_OBSERVED_ENABLED']) {
    if (local[key]) vars[key] = local[key];
  }
  if (vars.SOURCE_MET_NOWCAST_ENABLED === 'true') {
    const contact = new URL(vars.MET_NORWAY_CONTACT);
    if (!['http:', 'https:'].includes(contact.protocol)) throw new Error('MET contact must be a public HTTP(S) URL.');
  }
  vars.SOURCE_SL_DEVIATIONS_ENABLED = 'false';
  return vars;
}
