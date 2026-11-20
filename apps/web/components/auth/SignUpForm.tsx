'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSignUp } from '@clerk/nextjs';
import { authErrors, hasCode, NETWORK_ERROR, type AuthErrors } from '@/lib/auth/clerk-errors';
import { AUTH_LINKS } from '@/lib/auth/links';
import { EMAIL_RE } from '@/lib/auth/password';
import { destinationFor } from '@/lib/auth/redirect';
import { useClerkSettings } from '@/lib/auth/use-clerk-settings';
import { readSignupEmail } from '@/lib/landing/signup-email';
import { AuthHeading, AuthSteps, Checkbox, CodeField, FormAlert, FormNotice, PasswordField, SubmitButton, TextField, type SubmitState } from './AuthFields';
import f from './AuthForm.module.css';

type Step = 'details' | 'verify';
type Errors = AuthErrors & { terms?: string };

const Steps = () => <AuthSteps current={1} />;

function LegalLink({ href, children }: { href: string | null; children: ReactNode }) {
  return href ? <Link href={href} className={f.link} target="_blank">{children}</Link> : <span style={{ fontWeight: 500 }}>{children}</span>;
}

/**
 * Custom sign-up built on Clerk's sign-up API so the screen matches the approved design.
 * Step 1 of 2: account (name, work e-mail, password, terms) + e-mail code; step 2 is the
 * organization on /onboarding.
 */
export function SignUpForm() {
  const { signUp } = useSignUp();
  const router = useRouter();
  const { loaded, passwordMinLength, legalConsent } = useClerkSettings();

  const [step, setStep] = useState<Step>('details');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [terms, setTerms] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState<SubmitState>('idle');
  const [resending, setResending] = useState(false);

  // E-mail typed on the landing page (sessionStorage – read after hydration).
  useEffect(() => {
    const prefill = readSignupEmail();
    if (prefill) setEmail((cur) => cur || prefill);
  }, []);

  const clearError = (k: keyof Errors) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  const fail = (e: Errors) => {
    setErrors(e);
    setStatus('idle');
  };

  async function finish() {
    setStatus('done');
    const { error } = await signUp.finalize({
      navigate: async ({ session, decorateUrl }) => {
        const url = decorateUrl(destinationFor(session?.currentTask?.key, '/onboarding'));
        if (url.startsWith('http')) window.location.href = url;
        else router.push(url);
      },
    });
    if (error) fail(authErrors(error, 'signUp'));
  }

  async function continueSignUp() {
    if (signUp.status === 'complete') return finish();
    if (signUp.unverifiedFields.includes('email_address')) {
      const { error } = await signUp.verifications.sendEmailCode();
      if (error) return fail(authErrors(error, 'signUp'));
      setStep('verify');
      setErrors({});
      setStatus('idle');
      return;
    }
    fail({ form: 'Kontot kunde inte skapas. Försök igen eller kontakta supporten.' });
  }

  async function guarded(run: () => Promise<void>) {
    if (!loaded) return fail({ form: 'Registreringen laddar fortfarande. Försök igen om ett ögonblick.' });
    setStatus('loading');
    setNotice('');
    try {
      await run();
    } catch {
      fail({ form: NETWORK_ERROR });
    }
  }

  const submitDetails = (e: FormEvent) => {
    e.preventDefault();
    const errs: Errors = {};
    const mail = email.trim();
    if (!first.trim()) errs.firstName = 'Obligatoriskt.';
    if (!last.trim()) errs.lastName = 'Obligatoriskt.';
    if (!EMAIL_RE.test(mail)) errs.email = mail ? 'Ange en giltig e-postadress.' : 'Ange din jobbmejl.';
    if (pw.length < passwordMinLength) errs.password = `Lösenordet behöver minst ${passwordMinLength} tecken.`;
    if (!terms) errs.terms = 'Du behöver godkänna villkoren.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    void guarded(async () => {
      const { error } = await signUp.password({
        emailAddress: mail,
        password: pw,
        firstName: first.trim(),
        lastName: last.trim(),
        ...(legalConsent ? { legalAccepted: true } : {}),
      });
      if (error) {
        if (hasCode(error, 'session_exists')) {
          router.push('/overview');
          return;
        }
        return fail(authErrors(error, 'signUp'));
      }
      await continueSignUp();
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    const value = code.trim();
    if (!value) return setErrors({ code: 'Ange koden från mejlet.' });
    void guarded(async () => {
      const { error } = await signUp.verifications.verifyEmailCode({ code: value });
      if (error) return fail(authErrors(error, 'signUp'));
      await continueSignUp();
    });
  };

  const resend = async () => {
    setResending(true);
    setErrors({});
    try {
      const { error } = await signUp.verifications.sendEmailCode();
      if (error) setErrors(authErrors(error, 'signUp'));
      else setNotice('En ny kod är skickad.');
    } catch {
      setErrors({ form: NETWORK_ERROR });
    } finally {
      setResending(false);
    }
  };

  const changeEmail = () => {
    setStep('details');
    setCode('');
    setErrors({});
    setNotice('');
    setStatus('idle');
  };

  if (step === 'verify') {
    return (
      <div className={`${f.screen} ${f.screenTight}`}>
        <Steps />
        <AuthHeading title="Bekräfta din e-post" lead={<>Vi har skickat en sexsiffrig kod till <strong>{email.trim()}</strong>.</>} />
        <form onSubmit={submitCode} noValidate className={`${f.form} ${f.formTight}`}>
          <FormAlert>{errors.form}</FormAlert>
          <FormNotice>{notice}</FormNotice>
          <CodeField value={code} onValue={(v) => { setCode(v); clearError('code'); }} error={errors.code} />
          <div className={f.row}>
            <span className={f.rowLink} style={{ color: '#6B737B' }}>Fick du ingen kod?</span>
            <button type="button" className={`${f.linkButton} ${f.rowLink}`} onClick={resend} disabled={resending}>Skicka igen</button>
          </div>
          <SubmitButton state={status} idle="Bekräfta e-post" loading="Kontrollerar…" done="Konto skapat – nästa: organisation" />
        </form>
        <div className={f.alt}>
          Fel adress? <button type="button" className={f.linkButton} onClick={changeEmail}>Ändra e-post</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${f.screen} ${f.screenTight}`}>
      <Steps />
      <AuthHeading title="Skapa ditt konto" lead="Därefter skapar du en organisation – din arbetsyta för fastigheter och larm." />
      <form onSubmit={submitDetails} noValidate className={`${f.form} ${f.formTight}`}>
        <FormAlert>{errors.form}</FormAlert>
        <div className={f.pair}>
          <TextField label="Förnamn" autoComplete="given-name" placeholder="Elin" value={first} onValue={(v) => { setFirst(v); clearError('firstName'); }} error={errors.firstName} />
          <TextField label="Efternamn" autoComplete="family-name" placeholder="Lindqvist" value={last} onValue={(v) => { setLast(v); clearError('lastName'); }} error={errors.lastName} />
        </div>
        <TextField
          label="Jobbmejl"
          type="email"
          autoComplete="email"
          placeholder="namn@foretag.se"
          value={email}
          onValue={(v) => { setEmail(v); clearError('email'); }}
          error={errors.email}
        />
        <PasswordField
          label="Lösenord"
          autoComplete="new-password"
          placeholder="Skapa ett lösenord"
          value={pw}
          onValue={(v) => { setPw(v); clearError('password'); }}
          error={errors.password}
          shown={showPw}
          onToggle={() => setShowPw((x) => !x)}
          meter={{ minLength: passwordMinLength }}
        />
        <Checkbox checked={terms} onChange={(v) => { setTerms(v); clearError('terms'); }} error={errors.terms} top>
          Jag godkänner <LegalLink href={AUTH_LINKS.terms}>villkoren</LegalLink> och <LegalLink href={AUTH_LINKS.privacy}>integritetspolicyn</LegalLink>.
        </Checkbox>
        {/* Clerk bot protection renders its (usually invisible) challenge here when enabled. */}
        <div id="clerk-captcha" />
        <SubmitButton state={status} idle="Skapa konto" loading="Skapar konto…" done="Konto skapat – nästa: organisation" />
      </form>
      <div className={f.alt}>
        Har du redan ett konto? <Link href="/sign-in" className={f.link}>Logga in</Link>
      </div>
    </div>
  );
}
