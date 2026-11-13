import { describe, expect, it } from 'vitest';
import { enUS, svSE } from '@clerk/localizations';
import { clerkSv } from '@/lib/i18n/clerk-sv';

/**
 * Every Clerk string a FastighetsRadar user can reach must be Swedish. Clerk falls back to
 * English for keys the svSE pack leaves empty, so this walks enUS and reports gaps outside
 * features this application does not enable (enterprise SSO, billing, API keys, …).
 */
const NOT_ENABLED = /^(billing|apiKeys|configureSSO|configureDirectorySync|oauthConsent|oauthDeviceVerification|badge__|formFieldInputPlaceholder__apiKey)|^organizationProfile\.(securityPage|badge__enterpriseSso|navbar\.(billing|security)|invitePage\.formButtonPrimary__purchaseSeats)|^userProfile\.(navbar\.billing|emailAddressPage\.enterpriseSSOLink)|^signIn\.(enterpriseSSO|ssoBypass)|alternativePhoneCodeProvider|waitlist|Waitlist|enterpriseConnections|web3|Web3|passkey|Passkey|apiKey|api_key|sso_bypass|billing|plansPage/;

type Dict = Record<string, unknown>;
function missing(sv: unknown, en: Dict, path = ''): string[] {
  const out: string[] = [];
  for (const [k, e] of Object.entries(en)) {
    const p = path ? `${path}.${k}` : k;
    const s = sv && typeof sv === 'object' ? (sv as Dict)[k] : undefined;
    if (e && typeof e === 'object') out.push(...missing(s, e as Dict, p));
    else if (typeof e === 'string' && (s === undefined || s === null) && !NOT_ENABLED.test(p)) out.push(p);
  }
  return out;
}

describe('Clerk Swedish localization', () => {
  it('has no English fallbacks in flows the application uses', () => {
    expect(missing(clerkSv, enUS as unknown as Dict)).toEqual([]);
  });

  it('keeps every translation from the official svSE pack', () => {
    expect(clerkSv.signIn?.start?.title).toBe(svSE.signIn?.start?.title);
    expect((clerkSv as unknown as { userButton: Dict }).userButton.action__openUserMenu).toBe('Öppna användarmenyn');
  });
});
