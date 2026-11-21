// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const signIn = {
  status: 'needs_identifier' as string,
  supportedSecondFactors: [] as Array<{ strategy: string }>,
  password: vi.fn(),
  finalize: vi.fn(),
  reset: vi.fn(),
  create: vi.fn(),
  resetPasswordEmailCode: { sendCode: vi.fn(), verifyCode: vi.fn(), submitPassword: vi.fn() },
  mfa: { sendEmailCode: vi.fn(), sendPhoneCode: vi.fn(), verifyEmailCode: vi.fn(), verifyPhoneCode: vi.fn(), verifyTOTP: vi.fn(), verifyBackupCode: vi.fn() },
};
const signUp = {
  status: 'missing_requirements' as string,
  unverifiedFields: [] as string[],
  password: vi.fn(),
  finalize: vi.fn(),
  verifications: { sendEmailCode: vi.fn(), verifyEmailCode: vi.fn() },
};
vi.mock('@clerk/nextjs', () => ({
  useSignIn: () => ({ signIn, errors: {}, fetchStatus: 'idle' }),
  useSignUp: () => ({ signUp, errors: {}, fetchStatus: 'idle' }),
  useClerk: () => ({ loaded: true, environment: { userSettings: { passwordSettings: { min_length: 12 }, signUp: { legal_consent_enabled: false } } } }),
}));

import { LEGAL_VERSIONS } from '@fastighetsradar/domain';
import { SignInForm } from '@/components/auth/SignInForm';
import { SignUpForm } from '@/components/auth/SignUpForm';

beforeEach(() => {
  vi.clearAllMocks();
  signIn.status = 'needs_identifier';
  signUp.status = 'missing_requirements';
  signUp.unverifiedFields = [];
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(cleanup);

describe('SignInForm', () => {
  it('validates locally before contacting Clerk', () => {
    render(<SignInForm />);
    fireEvent.click(screen.getByRole('button', { name: /Logga in/ }));
    expect(screen.getByText('Ange din e-postadress.')).toBeTruthy();
    expect(screen.getByText('Ange ditt lösenord.')).toBeTruthy();
    expect(signIn.password).not.toHaveBeenCalled();
  });

  it('signs in with e-mail + password and finalizes the session', async () => {
    signIn.password.mockImplementation(async () => {
      signIn.status = 'complete';
      return { error: null };
    });
    signIn.finalize.mockResolvedValue({ error: null });
    render(<SignInForm />);
    fireEvent.change(screen.getByLabelText('E-postadress'), { target: { value: 'anna@exempel.se' } });
    fireEvent.change(screen.getByLabelText('Lösenord'), { target: { value: 'hemligt-losen' } });
    fireEvent.click(screen.getByRole('button', { name: /Logga in/ }));
    await waitFor(() => expect(signIn.finalize).toHaveBeenCalled());
    expect(signIn.password).toHaveBeenCalledWith({ emailAddress: 'anna@exempel.se', password: 'hemligt-losen' });
    expect(screen.getByRole('button', { name: /Inloggad – öppnar översikten/ })).toBeTruthy();
  });

  it('shows Clerk errors in Swedish on the matching field', async () => {
    signIn.password.mockResolvedValue({ error: { errors: [{ code: 'form_password_incorrect', message: 'Password is incorrect.', meta: { paramName: 'password' } }] } });
    render(<SignInForm />);
    fireEvent.change(screen.getByLabelText('E-postadress'), { target: { value: 'anna@exempel.se' } });
    fireEvent.change(screen.getByLabelText('Lösenord'), { target: { value: 'fel' } });
    fireEvent.click(screen.getByRole('button', { name: /Logga in/ }));
    expect(await screen.findByText(/^Fel lösenord/)).toBeTruthy();
    expect(screen.queryByText(/Password is incorrect/)).toBeNull();
  });

  it('asks for an e-mail code when Clerk requires a new-device check', async () => {
    signIn.password.mockImplementation(async () => {
      signIn.status = 'needs_client_trust';
      signIn.supportedSecondFactors = [{ strategy: 'email_code' }];
      return { error: null };
    });
    signIn.mfa.sendEmailCode.mockResolvedValue({ error: null });
    render(<SignInForm />);
    fireEvent.change(screen.getByLabelText('E-postadress'), { target: { value: 'anna@exempel.se' } });
    fireEvent.change(screen.getByLabelText('Lösenord'), { target: { value: 'hemligt-losen' } });
    fireEvent.click(screen.getByRole('button', { name: /Logga in/ }));
    expect(await screen.findByRole('heading', { name: 'Bekräfta att det är du' })).toBeTruthy();
    expect(signIn.mfa.sendEmailCode).toHaveBeenCalled();
  });

  it('opens the password reset step from "Glömt lösenordet?"', () => {
    render(<SignInForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Glömt lösenordet?' }));
    expect(screen.getByRole('heading', { name: 'Återställ lösenordet' })).toBeTruthy();
  });
});

describe('SignUpForm', () => {
  it('validates every field with the instance minimum password length', () => {
    render(<SignUpForm />);
    fireEvent.click(screen.getByRole('button', { name: /Skapa konto/ }));
    expect(screen.getAllByText('Obligatoriskt.')).toHaveLength(2);
    expect(screen.getByText('Ange din jobbmejl.')).toBeTruthy();
    expect(screen.getByText('Lösenordet behöver minst 12 tecken.')).toBeTruthy();
    expect(screen.getByText('Kryssa i rutan för att skapa kontot.')).toBeTruthy();
    expect(signUp.password).not.toHaveBeenCalled();
  });

  it('asks for the B2B declaration and links the terms, DPA and privacy policy in a new tab', () => {
    render(<SignUpForm />);
    const box = screen.getByRole('checkbox');
    const label = box.closest('label')!;
    expect(label.textContent).toContain('Jag intygar att jag registrerar kontot för ett företag, en bostadsrättsförening eller annan organisation (ej privatperson)');
    const links = Object.fromEntries([...label.querySelectorAll('a')].map((a) => [a.textContent, a]));
    expect(links['Användarvillkor']!.getAttribute('href')).toBe('/villkor');
    expect(links['PUB-avtal']!.getAttribute('href')).toBe('/pub-avtal');
    expect(links['Integritetspolicyn']!.getAttribute('href')).toBe('/integritetspolicy');
    for (const a of Object.values(links)) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('prefills the e-mail typed on the landing page', async () => {
    sessionStorage.setItem('fr-signup-email', 'anna@exempel.se');
    render(<SignUpForm />);
    await waitFor(() => expect((screen.getByLabelText('Jobbmejl') as HTMLInputElement).value).toBe('anna@exempel.se'));
  });

  it('creates the account and moves to e-mail verification', async () => {
    signUp.password.mockImplementation(async () => {
      signUp.unverifiedFields = ['email_address'];
      return { error: null };
    });
    signUp.verifications.sendEmailCode.mockResolvedValue({ error: null });
    render(<SignUpForm />);
    fireEvent.change(screen.getByLabelText('Förnamn'), { target: { value: 'Elin' } });
    fireEvent.change(screen.getByLabelText('Efternamn'), { target: { value: 'Lindqvist' } });
    fireEvent.change(screen.getByLabelText('Jobbmejl'), { target: { value: 'elin@foretag.se' } });
    fireEvent.change(screen.getByLabelText('Lösenord'), { target: { value: 'ett-langt-losenord' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Skapa konto/ }));
    expect(await screen.findByRole('heading', { name: 'Bekräfta din e-post' })).toBeTruthy();
    expect(signUp.password).toHaveBeenCalledWith({
      emailAddress: 'elin@foretag.se', password: 'ett-langt-losenord', firstName: 'Elin', lastName: 'Lindqvist',
      // The accepted versions and time travel with the user until the organization exists.
      unsafeMetadata: { legal: { termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy, acceptedAt: expect.any(String) } },
    });
  });
});
