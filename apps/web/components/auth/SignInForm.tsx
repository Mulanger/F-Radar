'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useSignIn } from '@clerk/nextjs';
import { authErrors, hasCode, NETWORK_ERROR, type AuthErrors } from '@/lib/auth/clerk-errors';
import { EMAIL_RE } from '@/lib/auth/password';
import { destinationFor } from '@/lib/auth/redirect';
import { rememberSession } from '@/lib/auth/remember-me';
import { useClerkSettings } from '@/lib/auth/use-clerk-settings';
import { AuthHeading, Checkbox, CodeField, FormAlert, FormNotice, PasswordField, SubmitButton, TextField, type SubmitState } from './AuthFields';
import f from './AuthForm.module.css';

type Step = 'password' | 'second-factor' | 'reset-request' | 'reset-verify';
type SecondFactor = 'email_code' | 'phone_code' | 'totp' | 'backup_code';

const SECOND_FACTOR_ORDER: SecondFactor[] = ['email_code', 'phone_code', 'totp', 'backup_code'];

/**
 * Custom sign-in built on Clerk's sign-in API so the screen matches the approved design:
 * e-mail + password, optional second factor / new-device check, and password reset by e-mail code.
 */
export function SignInForm() {
  const { signIn } = useSignIn();
  const router = useRouter();
  const { loaded, passwordMinLength } = useClerkSettings();

  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState('');
  const [newPw, setNewPw] = useState('');
  const [factor, setFactor] = useState<SecondFactor | null>(null);
  const [errors, setErrors] = useState<AuthErrors>({});
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState<SubmitState>('idle');
  const [resending, setResending] = useState(false);

  const clearError = (k: keyof AuthErrors) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  const go = (next: Step) => {
    setStep(next);
    setErrors({});
    setNotice('');
    setCode('');
    setStatus('idle');
  };
  const fail = (e: AuthErrors) => {
    setErrors(e);
    setStatus('idle');
  };

  async function finish() {
    setStatus('done');
    rememberSession(remember);
    const { error } = await signIn.finalize({
      navigate: async ({ session, decorateUrl }) => {
        const url = decorateUrl(destinationFor(session?.currentTask?.key, '/overview'));
        if (url.startsWith('http')) window.location.href = url;
        else router.push(url);
      },
    });
    if (error) fail(authErrors(error, 'signIn'));
  }

  async function sendSecondFactor(strategy: SecondFactor) {
    if (strategy === 'email_code') return signIn.mfa.sendEmailCode();
    if (strategy === 'phone_code') return signIn.mfa.sendPhoneCode();
    return { error: null };
  }

  /** Routes on the sign-in status after a password or reset attempt. */
  async function continueSignIn() {
    const st = signIn.status;
    if (st === 'complete') return finish();
    if (st === 'needs_second_factor' || st === 'needs_client_trust') {
      const supported = new Set(signIn.supportedSecondFactors.map((x) => x.strategy));
      const pick = SECOND_FACTOR_ORDER.find((s) => supported.has(s));
      if (!pick) return fail({ form: 'Ditt konto kräver en verifieringsmetod som inte stöds här. Kontakta supporten.' });
      const { error } = await sendSecondFactor(pick);
      if (error) return fail(authErrors(error, 'signIn'));
      setFactor(pick);
      go('second-factor');
      return;
    }
    if (st === 'needs_new_password') {
      go('reset-verify');
      return;
    }
    fail({ form: 'Inloggningen kunde inte slutföras. Försök igen.' });
  }

  async function guarded(run: () => Promise<void>) {
    if (!loaded) return fail({ form: 'Inloggningen laddar fortfarande. Försök igen om ett ögonblick.' });
    setStatus('loading');
    setNotice('');
    try {
      await run();
    } catch {
      fail({ form: NETWORK_ERROR });
    }
  }

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    const errs: AuthErrors = {};
    const id = email.trim();
    if (!EMAIL_RE.test(id)) errs.email = id ? 'Ange en giltig e-postadress.' : 'Ange din e-postadress.';
    if (!pw) errs.password = 'Ange ditt lösenord.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    void guarded(async () => {
      const { error } = await signIn.password({ emailAddress: id, password: pw });
      if (error) {
        if (hasCode(error, 'session_exists')) {
          router.push(destinationFor(undefined, '/overview'));
          return;
        }
        return fail(authErrors(error, 'signIn'));
      }
      await continueSignIn();
    });
  };

  const submitSecondFactor = (e: FormEvent) => {
    e.preventDefault();
    const value = code.trim();
    if (!value) return setErrors({ code: 'Ange koden.' });
    void guarded(async () => {
      const verify = {
        email_code: () => signIn.mfa.verifyEmailCode({ code: value }),
        phone_code: () => signIn.mfa.verifyPhoneCode({ code: value }),
        totp: () => signIn.mfa.verifyTOTP({ code: value }),
        backup_code: () => signIn.mfa.verifyBackupCode({ code: value }),
      }[factor ?? 'email_code'];
      const { error } = await verify();
      if (error) return fail(authErrors(error, 'signIn'));
      await continueSignIn();
    });
  };

  const submitResetRequest = (e: FormEvent) => {
    e.preventDefault();
    const id = email.trim();
    if (!EMAIL_RE.test(id)) return setErrors({ email: id ? 'Ange en giltig e-postadress.' : 'Ange din e-postadress.' });
    void guarded(async () => {
      const created = await signIn.create({ identifier: id });
      if (created.error) return fail(authErrors(created.error, 'reset'));
      const sent = await signIn.resetPasswordEmailCode.sendCode();
      if (sent.error) return fail(authErrors(sent.error, 'reset'));
      go('reset-verify');
    });
  };

  const submitReset = (e: FormEvent) => {
    e.preventDefault();
    const errs: AuthErrors = {};
    const value = code.trim();
    const codeDone = signIn.status === 'needs_new_password';
    if (!codeDone && !value) errs.code = 'Ange koden från mejlet.';
    if (newPw.length < passwordMinLength) errs.password = `Lösenordet behöver minst ${passwordMinLength} tecken.`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    void guarded(async () => {
      if (!codeDone) {
        const verified = await signIn.resetPasswordEmailCode.verifyCode({ code: value });
        if (verified.error) return fail(authErrors(verified.error, 'reset'));
      }
      const saved = await signIn.resetPasswordEmailCode.submitPassword({ password: newPw, signOutOfOtherSessions: true });
      if (saved.error) return fail(authErrors(saved.error, 'reset'));
      await continueSignIn();
    });
  };

  const resend = async () => {
    setResending(true);
    setErrors({});
    try {
      const { error } = step === 'reset-verify'
        ? await signIn.resetPasswordEmailCode.sendCode()
        : await sendSecondFactor(factor ?? 'email_code');
      if (error) setErrors(authErrors(error, 'signIn'));
      else setNotice('En ny kod är skickad.');
    } catch {
      setErrors({ form: NETWORK_ERROR });
    } finally {
      setResending(false);
    }
  };

  const backToLogin = () => {
    void signIn.reset();
    setPw('');
    setNewPw('');
    go('password');
  };

  if (step === 'second-factor') {
    const lead = factor === 'totp'
      ? 'Ange den sexsiffriga koden från din autentiseringsapp.'
      : factor === 'backup_code'
        ? 'Ange en av dina reservkoder.'
        : factor === 'phone_code'
          ? 'Vi har skickat en kod till ditt telefonnummer.'
          : <>Vi har skickat en kod till <strong>{email.trim()}</strong>.</>;
    return (
      <div className={f.screen}>
        <AuthHeading title="Bekräfta att det är du" lead={lead} />
        <form onSubmit={submitSecondFactor} noValidate className={f.form}>
          <FormAlert>{errors.form}</FormAlert>
          <FormNotice>{notice}</FormNotice>
          <CodeField value={code} onValue={(v) => { setCode(v); clearError('code'); }} error={errors.code} length={factor === 'backup_code' ? 0 : 6} label={factor === 'backup_code' ? 'Reservkod' : 'Verifieringskod'} />
          {factor === 'email_code' || factor === 'phone_code' ? (
            <div className={f.row}>
              <span className={f.rowLink} style={{ color: '#6B737B' }}>Fick du ingen kod?</span>
              <button type="button" className={`${f.linkButton} ${f.rowLink}`} onClick={resend} disabled={resending}>Skicka igen</button>
            </div>
          ) : null}
          <SubmitButton state={status} idle="Bekräfta" loading="Kontrollerar…" done="Inloggad – öppnar översikten" />
        </form>
        <div className={f.alt}>
          <button type="button" className={f.linkButton} onClick={backToLogin}>Tillbaka till inloggningen</button>
        </div>
      </div>
    );
  }

  if (step === 'reset-request') {
    return (
      <div className={f.screen}>
        <AuthHeading title="Återställ lösenordet" lead="Ange e-postadressen du loggar in med, så skickar vi en kod för att välja ett nytt lösenord." />
        <form onSubmit={submitResetRequest} noValidate className={f.form}>
          <FormAlert>{errors.form}</FormAlert>
          <TextField
            label="E-postadress"
            type="email"
            autoComplete="email"
            placeholder="namn@foretag.se"
            value={email}
            onValue={(v) => { setEmail(v); clearError('email'); }}
            error={errors.email}
            autoFocus
          />
          <SubmitButton state={status} idle="Skicka kod" loading="Skickar kod…" done="Kod skickad" />
        </form>
        <div className={f.alt}>
          <button type="button" className={f.linkButton} onClick={backToLogin}>Tillbaka till inloggningen</button>
        </div>
      </div>
    );
  }

  if (step === 'reset-verify') {
    const codeDone = signIn.status === 'needs_new_password';
    return (
      <div className={f.screen}>
        <AuthHeading
          title="Välj ett nytt lösenord"
          lead={codeDone ? 'Ange ditt nya lösenord.' : <>Vi har skickat en kod till <strong>{email.trim()}</strong>. Ange den och ditt nya lösenord.</>}
        />
        <form onSubmit={submitReset} noValidate className={f.form}>
          <FormAlert>{errors.form}</FormAlert>
          <FormNotice>{notice}</FormNotice>
          {codeDone ? null : <CodeField value={code} onValue={(v) => { setCode(v); clearError('code'); }} error={errors.code} />}
          <PasswordField
            label="Nytt lösenord"
            autoComplete="new-password"
            placeholder="Skapa ett lösenord"
            value={newPw}
            onValue={(v) => { setNewPw(v); clearError('password'); }}
            error={errors.password}
            shown={showPw}
            onToggle={() => setShowPw((x) => !x)}
            meter={{ minLength: passwordMinLength }}
          />
          {codeDone ? null : (
            <div className={f.row}>
              <span className={f.rowLink} style={{ color: '#6B737B' }}>Fick du ingen kod?</span>
              <button type="button" className={`${f.linkButton} ${f.rowLink}`} onClick={resend} disabled={resending}>Skicka igen</button>
            </div>
          )}
          <SubmitButton state={status} idle="Spara och logga in" loading="Sparar…" done="Inloggad – öppnar översikten" />
        </form>
        <div className={f.alt}>
          <button type="button" className={f.linkButton} onClick={backToLogin}>Tillbaka till inloggningen</button>
        </div>
      </div>
    );
  }

  return (
    <div className={f.screen}>
      <AuthHeading title="Välkommen tillbaka" lead="Logga in för att bevaka dina fastigheter med svenska offentliga data." />
      <form onSubmit={submitPassword} noValidate className={f.form}>
        <FormAlert>{errors.form}</FormAlert>
        <TextField
          label="E-postadress"
          type="email"
          autoComplete="email"
          placeholder="namn@foretag.se"
          value={email}
          onValue={(v) => { setEmail(v); clearError('email'); }}
          error={errors.email}
        />
        <PasswordField
          label="Lösenord"
          autoComplete="current-password"
          placeholder="Ange ditt lösenord"
          value={pw}
          onValue={(v) => { setPw(v); clearError('password'); }}
          error={errors.password}
          shown={showPw}
          onToggle={() => setShowPw((x) => !x)}
        />
        <div className={f.row}>
          <Checkbox checked={remember} onChange={setRemember}>Kom ihåg mig</Checkbox>
          <button type="button" className={`${f.linkButton} ${f.rowLink}`} onClick={() => go('reset-request')}>Glömt lösenordet?</button>
        </div>
        <SubmitButton state={status} idle="Logga in" loading="Loggar in…" done="Inloggad – öppnar översikten" />
      </form>
      <div className={f.alt}>
        Har du inget konto? <Link href="/sign-up" className={f.link}>Skapa konto</Link>
      </div>
    </div>
  );
}
