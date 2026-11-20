'use client';

import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { passwordStrength, strengthMeter } from '@/lib/auth/password';
import f from './AuthForm.module.css';

export function AuthHeading({ title, lead }: { title: string; lead: ReactNode }) {
  return (
    <div className={f.head}>
      <h1 className={f.title}>{title}</h1>
      <p className={f.lead}>{lead}</p>
    </div>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string;
  value: string;
  onValue: (v: string) => void;
  error?: string;
  children?: ReactNode;
  inputClassName?: string;
};

export function TextField({ label, value, onValue, error, children, inputClassName, ...rest }: InputProps) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className={f.field}>
      <label htmlFor={id} className={f.label}>{label}</label>
      <input
        id={id}
        className={`${f.input}${inputClassName ? ` ${inputClassName}` : ''}`}
        value={value}
        onChange={(e) => onValue(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        {...rest}
      />
      {children}
      {error ? <div id={errId} className={f.error}>{error}</div> : null}
    </div>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      <path className={f.slash} d="M4 4l16 16" style={{ opacity: open ? 1 : 0 }} />
    </svg>
  );
}

type PasswordProps = Omit<InputProps, 'type' | 'children'> & {
  shown: boolean;
  onToggle: () => void;
  meter?: { minLength: number };
};

export function PasswordField({ label, value, onValue, error, shown, onToggle, meter, ...rest }: PasswordProps) {
  const id = useId();
  const errId = `${id}-err`;
  const meterId = `${id}-meter`;
  const score = meter ? passwordStrength(value, meter.minLength) : 0;
  const m = meter ? strengthMeter(score, meter.minLength) : null;
  const describedBy = [error ? errId : '', m ? meterId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={f.field}>
      <label htmlFor={id} className={f.label}>{label}</label>
      <div className={f.control}>
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          className={`${f.input} ${f.withToggle}`}
          value={value}
          onChange={(e) => onValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
        <button type="button" className={f.toggle} onClick={onToggle} aria-label={shown ? 'Dölj lösenord' : 'Visa lösenord'} aria-pressed={shown}>
          <EyeIcon open={shown} />
        </button>
      </div>
      {m ? (
        <div className={f.meter}>
          <div className={f.bars} aria-hidden="true">
            {m.bars.map((bg, i) => <span key={i} className={f.bar} style={{ background: bg }} />)}
          </div>
          <span id={meterId} className={f.meterLabel} style={{ color: m.color }} aria-live="polite">{m.label}</span>
        </div>
      ) : null}
      {error ? <div id={errId} className={f.error}>{error}</div> : null}
    </div>
  );
}

export function Checkbox({ checked, onChange, children, error, top }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  error?: string;
  top?: boolean;
}) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className={f.field} style={{ gap: 6 }}>
      <label className={`${f.check}${top ? ` ${f.checkTop}` : ''}`}>
        <input
          type="checkbox"
          className={f.checkInput}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
        />
        <span className={f.box} aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <span>{children}</span>
      </label>
      {error ? <div id={errId} className={`${f.error} ${f.checkError}`}>{error}</div> : null}
    </div>
  );
}

export type SubmitState = 'idle' | 'loading' | 'done';

export function SubmitButton({ state, idle, loading, done }: { state: SubmitState; idle: string; loading: string; done: string }) {
  return (
    <button type="submit" className={f.submit} disabled={state !== 'idle'} aria-busy={state === 'loading' || undefined}>
      {state === 'idle' ? (
        <>
          {idle}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </>
      ) : state === 'loading' ? (
        <>
          <span className={f.spinner} aria-hidden="true" />
          {loading}
        </>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="oklch(0.8 0.14 155)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          {done}
        </>
      )}
    </button>
  );
}

export function FormAlert({ children }: { children?: string }) {
  if (!children) return null;
  return <p className={f.alert} role="alert">{children}</p>;
}

export function FormNotice({ children }: { children?: string }) {
  if (!children) return null;
  return <p className={f.notice} role="status">{children}</p>;
}

/** Six-digit verification code input (e-mail, SMS, authenticator app). */
export function CodeField({ value, onValue, error, label = 'Verifieringskod', length = 6, autoFocus = true }: {
  value: string;
  onValue: (v: string) => void;
  error?: string;
  label?: string;
  length?: number;
  autoFocus?: boolean;
}) {
  return (
    <TextField
      label={label}
      value={value}
      onValue={(v) => onValue(length === 6 ? v.replace(/\D/g, '').slice(0, 6) : v.trim())}
      error={error}
      inputMode={length === 6 ? 'numeric' : 'text'}
      autoComplete="one-time-code"
      placeholder={length === 6 ? '000000' : ''}
      maxLength={length === 6 ? 6 : 64}
      inputClassName={length === 6 ? f.code : undefined}
      autoFocus={autoFocus}
    />
  );
}

export function useToggle(initial = false): [boolean, () => void] {
  const [v, setV] = useState(initial);
  return [v, () => setV((x) => !x)];
}
