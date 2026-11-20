'use client';

import { useState, type FormEvent } from 'react';
import type { AuthErrors } from '@/lib/auth/clerk-errors';
import { AuthHeading, AuthSteps, FormAlert, SubmitButton, TextField, type SubmitState } from './AuthFields';
import f from './AuthForm.module.css';

export interface OrganizationStepProps {
  email?: string;
  /** An existing organization is being opened instead (no form input needed). */
  redirecting?: boolean;
  /** Creates the company's organization; resolves with errors, or nothing once navigation has started. */
  onCreate: (name: string) => Promise<AuthErrors | void>;
  onSignOut: () => void;
}

/**
 * Step 2 of 2 after sign-up: the company name, which becomes the organization (workspace for
 * properties and alerts). Presentation only – Clerk calls are passed in by `OnboardingForm`.
 */
export function OrganizationStep({ email, redirecting, onCreate, onSignOut }: OrganizationStepProps) {
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<AuthErrors>({});
  const [status, setStatus] = useState<SubmitState>('idle');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) return setErrors({ name: 'Ange företagets namn.' });
    setErrors({});
    setStatus('loading');
    const result = await onCreate(value);
    if (result && Object.keys(result).length) {
      setErrors(result);
      setStatus('idle');
    } else {
      setStatus('done');
    }
  };

  return (
    <div className={`${f.screen} ${f.screenTight}`}>
      <AuthSteps current={2} />
      <AuthHeading title="Vad heter ditt företag?" lead="Företagsnamnet blir er arbetsyta för fastigheter och larm." />
      <form onSubmit={submit} noValidate className={`${f.form} ${f.formTight}`}>
        <FormAlert>{errors.form}</FormAlert>
        <TextField
          label="Företagsnamn"
          autoComplete="organization"
          placeholder="t.ex. Lindqvist Fastigheter AB"
          value={name}
          onValue={(v) => {
            setName(v);
            if (errors.name) setErrors((e) => ({ ...e, name: undefined }));
          }}
          error={errors.name}
          maxLength={256}
          disabled={redirecting}
          autoFocus
        />
        <SubmitButton state={redirecting ? 'done' : status} idle="Kom igång" loading="Skapar arbetsyta…" done="Klart – öppnar översikten" />
      </form>
      <div className={f.alt}>
        {email ? <>Inloggad som <strong style={{ fontWeight: 500, color: '#14171A' }}>{email}</strong>. </> : null}
        <button type="button" className={f.linkButton} onClick={onSignOut}>Logga ut</button>
      </div>
    </div>
  );
}
