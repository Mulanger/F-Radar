import { clerkSv } from '@/lib/i18n/clerk-sv';

/** Form fields the custom sign-in / sign-up screens can attach an error to. */
export type AuthField = 'email' | 'password' | 'code' | 'firstName' | 'lastName' | 'name' | 'form';
export type AuthErrors = Partial<Record<AuthField, string>>;
export type AuthContext = 'signIn' | 'signUp' | 'reset' | 'organization';

interface ApiErrorLike {
  code?: string;
  message?: string;
  longMessage?: string;
  meta?: Record<string, unknown>;
}

const GENERIC = 'Något gick fel. Försök igen.';
const OFFLINE = 'Kunde inte nå inloggningstjänsten. Kontrollera anslutningen och försök igen.';

const PARAM_FIELD: Record<string, AuthField> = {
  identifier: 'email',
  email_address: 'email',
  emailAddress: 'email',
  password: 'password',
  new_password: 'password',
  code: 'code',
  first_name: 'firstName',
  firstName: 'firstName',
  last_name: 'lastName',
  lastName: 'lastName',
  name: 'name',
};

/** Field a Clerk error code belongs to when the API does not name a parameter. */
const CODE_FIELD: Record<string, AuthField> = {
  form_identifier_not_found: 'email',
  form_identifier_exists: 'email',
  form_password_incorrect: 'password',
  form_password_pwned: 'password',
  form_password_length_too_short: 'password',
  form_password_length_too_long: 'password',
  form_password_not_strong_enough: 'password',
  form_password_validation_failed: 'password',
  form_code_incorrect: 'code',
  verification_expired: 'code',
  verification_failed: 'code',
};

function minLengthFrom(e: ApiErrorLike): number | undefined {
  const fromMeta = e.meta?.min_length ?? e.meta?.minLength;
  if (typeof fromMeta === 'number') return fromMeta;
  const m = /(\d+)/.exec(e.longMessage ?? e.message ?? '');
  return m ? Number(m[1]) : undefined;
}

function svMessage(code: string): string | undefined {
  const table = (clerkSv as { unstable__errors?: Record<string, unknown> }).unstable__errors;
  const v = table?.[code];
  return typeof v === 'string' && !v.includes('{{') ? v : undefined;
}

function message(e: ApiErrorLike, ctx: AuthContext, field: AuthField): string {
  switch (e.code) {
    case 'form_identifier_not_found':
      return 'Det finns inget konto med den här e-postadressen.';
    case 'form_identifier_exists':
      return 'Det finns redan ett konto med den här e-postadressen. Logga in i stället.';
    case 'form_password_incorrect':
    case 'form_password_validation_failed':
      return 'Fel lösenord. Försök igen eller välj ”Glömt lösenordet?”.';
    case 'form_password_pwned':
      return ctx === 'signIn'
        ? 'Lösenordet har förekommit i en dataläcka. Välj ”Glömt lösenordet?” för att byta det.'
        : 'Lösenordet har förekommit i en dataläcka. Välj ett annat lösenord.';
    case 'form_password_length_too_short': {
      const n = minLengthFrom(e);
      return n ? `Lösenordet behöver minst ${n} tecken.` : 'Lösenordet är för kort.';
    }
    case 'form_password_length_too_long':
      return 'Lösenordet är för långt.';
    case 'form_password_not_strong_enough':
      return 'Lösenordet är för svagt. Välj ett längre eller mer varierat lösenord.';
    case 'strategy_for_user_invalid':
      return 'Kontot har inget lösenord ännu. Välj ”Glömt lösenordet?” för att skapa ett.';
    case 'form_code_incorrect':
      return 'Koden stämmer inte. Kontrollera och försök igen.';
    case 'verification_expired':
    case 'verification_failed':
      return 'Koden har gått ut. Skicka en ny kod.';
    case 'too_many_requests':
    case 'user_locked':
      return 'För många försök. Vänta en stund och försök igen.';
    case 'form_param_format_invalid':
      return field === 'email' ? 'Ange en giltig e-postadress.' : 'Ogiltigt värde.';
    case 'form_param_nil':
    case 'form_param_missing':
      return field === 'name' ? 'Ange ett namn på organisationen.' : 'Obligatoriskt.';
    case 'form_param_max_length_exceeded':
      return field === 'name' ? 'Namnet är för långt.' : 'Värdet är för långt.';
    case 'organization_membership_quota_exceeded':
      return 'Organisationen har inga lediga platser. Kontakta en administratör där.';
    case 'session_exists':
      return 'Du är redan inloggad.';
    default:
      return (e.code && (svMessage(`${e.code}__${field === 'email' ? 'email_address' : field}`) ?? svMessage(e.code))) || GENERIC;
  }
}

/** Translates an error returned by Clerk's sign-in / sign-up methods into per-field Swedish messages. */
export function authErrors(error: unknown, ctx: AuthContext): AuthErrors {
  if (!error || typeof error !== 'object') return { form: GENERIC };
  const list = (error as { errors?: ApiErrorLike[] }).errors;
  const items: ApiErrorLike[] = Array.isArray(list) && list.length ? list : [error as ApiErrorLike];
  const out: AuthErrors = {};
  for (const e of items) {
    const param = (e.meta?.paramName ?? e.meta?.param_name) as string | undefined;
    const field = (param && PARAM_FIELD[param]) || (e.code && CODE_FIELD[e.code]) || 'form';
    if (!out[field]) out[field] = message(e, ctx, field);
  }
  if (!Object.keys(out).length) out.form = GENERIC;
  const name = (error as { name?: string }).name;
  if (out.form === GENERIC && (name === 'ClerkOfflineError' || (error as { code?: string }).code === 'network_error')) out.form = OFFLINE;
  return out;
}

export function hasCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const list = (error as { errors?: ApiErrorLike[] }).errors;
  if (Array.isArray(list)) return list.some((e) => e.code === code);
  return (error as ApiErrorLike).code === code;
}

export const NETWORK_ERROR = OFFLINE;
