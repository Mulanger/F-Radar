import { describe, expect, it } from 'vitest';
import { authErrors, hasCode } from '@/lib/auth/clerk-errors';
import { passwordStrength, strengthMeter } from '@/lib/auth/password';
import { redirectTarget } from '@/lib/auth/redirect';

describe('passwordStrength (sign-up meter from the design)', () => {
  it('is 0 for an empty password and capped at 1 below the minimum length', () => {
    expect(passwordStrength('', 8)).toBe(0);
    expect(passwordStrength('Ab1!', 8)).toBe(1);
  });

  it('adds a point for length, mixed case, digits and symbols', () => {
    expect(passwordStrength('abcdefgh', 8)).toBe(1);
    expect(passwordStrength('Abcdefgh', 8)).toBe(2);
    expect(passwordStrength('Abcdefg1', 8)).toBe(3);
    expect(passwordStrength('Abcdef1!', 8)).toBe(4);
  });

  it('respects the instance minimum length', () => {
    expect(passwordStrength('Abcdef1!', 15)).toBe(1);
    expect(strengthMeter(0, 15).label).toBe('Minst 15 tecken');
    expect(strengthMeter(4, 8)).toMatchObject({ label: 'Mycket starkt' });
  });
});

describe('redirectTarget', () => {
  const origin = 'https://app.example.se';
  it('honours same-origin redirect_url and keeps path, query and hash', () => {
    expect(redirectTarget('?redirect_url=https%3A%2F%2Fapp.example.se%2Fproperties%3Fid%3D4%23map', origin, '/overview')).toBe('/properties?id=4#map');
  });

  it('ignores foreign origins, auth pages and garbage', () => {
    expect(redirectTarget('?redirect_url=https%3A%2F%2Fevil.example%2F', origin, '/overview')).toBe('/overview');
    expect(redirectTarget('?redirect_url=%2Fsign-in', origin, '/overview')).toBe('/overview');
    expect(redirectTarget('?redirect_url=http%3A%2F%2F%5B', origin, '/overview')).toBe('/overview');
    expect(redirectTarget('', origin, '/onboarding')).toBe('/onboarding');
  });
});

describe('authErrors', () => {
  const apiError = (...errors: Array<{ code: string; longMessage?: string; meta?: Record<string, unknown> }>) => ({ errors: errors.map((e) => ({ message: '', ...e })) });

  it('maps Clerk codes to Swedish messages on the right field', () => {
    expect(authErrors(apiError({ code: 'form_identifier_not_found', meta: { paramName: 'identifier' } }), 'signIn')).toEqual({
      email: 'Det finns inget konto med den här e-postadressen.',
    });
    expect(authErrors(apiError({ code: 'form_password_incorrect', meta: { paramName: 'password' } }), 'signIn').password).toMatch(/^Fel lösenord/);
    expect(authErrors(apiError({ code: 'form_identifier_exists', meta: { paramName: 'email_address' } }), 'signUp').email).toMatch(/redan ett konto/);
    expect(authErrors(apiError({ code: 'form_code_incorrect' }), 'signUp').code).toMatch(/Koden stämmer inte/);
  });

  it('reads the minimum length from the API message', () => {
    expect(authErrors(apiError({ code: 'form_password_length_too_short', longMessage: 'Passwords must be 15 characters or more.', meta: { paramName: 'password' } }), 'signUp')).toEqual({
      password: 'Lösenordet behöver minst 15 tecken.',
    });
  });

  it('falls back to a generic Swedish form error and never shows English', () => {
    expect(authErrors(apiError({ code: 'something_new' }), 'signIn')).toEqual({ form: 'Något gick fel. Försök igen.' });
    expect(authErrors(undefined, 'signIn')).toEqual({ form: 'Något gick fel. Försök igen.' });
  });

  it('detects specific codes', () => {
    expect(hasCode(apiError({ code: 'session_exists' }), 'session_exists')).toBe(true);
    expect(hasCode({ code: 'session_exists' }, 'session_exists')).toBe(true);
    expect(hasCode(apiError({ code: 'other' }), 'session_exists')).toBe(false);
  });
});
