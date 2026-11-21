'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useClerk } from '@clerk/nextjs';
import { LEGAL_VERSIONS, type LegalAcceptanceStatus } from '@fastighetsradar/domain';
import { LegalConsentText } from './LegalConsentText';
import css from './LegalAcceptanceGate.module.css';

async function accept(acceptedAt?: string): Promise<void> {
  const r = await fetch('/api/app/legal/acceptance', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy, ...(acceptedAt ? { acceptedAt } : {}) }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { title?: string } | null;
    throw new Error(r.status === 401 ? 'Du är inte inloggad längre. Ladda om sidan.' : body?.title || 'Det gick inte att spara. Försök igen.');
  }
}

/**
 * Makes sure the organization has accepted the current Användarvillkor, PUB-avtal and
 * Integritetspolicy (stored on the organization: version, time, user).
 *  - The acceptance made at sign-up is copied to the new organization without any UI.
 *  - Otherwise (accounts from before the terms existed, or a new version) an administrator is asked
 *    once in a dialog. Members who are not administrators are never blocked.
 */
export function LegalAcceptanceGate({ status, signupAcceptedAt }: { status: LegalAcceptanceStatus | null; signupAcceptedAt: string | null }) {
  const needed = Boolean(status && !status.current && status.canAccept);
  const [phase, setPhase] = useState<'syncing' | 'ask' | 'saving' | 'done'>(needed ? (signupAcceptedAt ? 'syncing' : 'ask') : 'done');
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const clerk = useClerk();
  const titleId = useId();
  const boxRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (phase !== 'syncing' || started.current || !signupAcceptedAt) return;
    started.current = true;
    accept(signupAcceptedAt).then(
      () => setPhase('done'),
      () => setPhase('ask'),
    );
  }, [phase, signupAcceptedAt]);

  useEffect(() => {
    if (phase === 'ask') boxRef.current?.focus({ preventScroll: true });
  }, [phase]);

  if (phase !== 'ask' && phase !== 'saving') return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checked) return setError('Kryssa i rutan för att fortsätta.');
    setError('');
    setPhase('saving');
    try {
      await accept();
      setPhase('done');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setPhase('ask');
    }
  };

  return (
    <div className={css.overlay}>
      <form className={css.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit} noValidate>
        <h2 id={titleId} className={css.title}>Godkänn villkoren för er organisation</h2>
        <p className={css.lead}>
          FastighetsRadar har publicerat användarvillkor, personuppgiftsbiträdesavtal och integritetspolicy. En administratör behöver godkänna dem
          en gång för organisationen innan ni fortsätter.
        </p>
        <label className={css.consent}>
          <input ref={boxRef} type="checkbox" checked={checked} onChange={(e) => { setChecked(e.target.checked); setError(''); }} aria-invalid={Boolean(error) || undefined} />
          <span><LegalConsentText linkClassName={css.link} /></span>
        </label>
        {error ? <p className={css.error} role="alert">{error}</p> : null}
        <div className={css.actions}>
          <button type="button" className={css.secondary} onClick={() => void clerk.signOut({ redirectUrl: '/sign-in' })}>Logga ut</button>
          <button type="submit" className={css.primary} disabled={phase === 'saving'}>{phase === 'saving' ? 'Sparar…' : 'Godkänn och fortsätt'}</button>
        </div>
      </form>
    </div>
  );
}
