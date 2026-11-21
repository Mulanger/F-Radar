import { LEGAL_VERSIONS } from '@fastighetsradar/domain';

/**
 * Company details used by the footer, the legal pages (/villkor, /integritetspolicy, /cookies,
 * /pub-avtal, /datakallor) and the PDF exports – the only place they are set.
 *
 * `null` = not decided yet: the pages then show the placeholder (e.g. "[ORG_NR]") so missing
 * details are visible. See docs/legal/README.md for what each value should contain.
 */
export const LEGAL_COMPANY: Record<LegalField, string | null> & { fSkatt: boolean | null } = {
  /** [FÖRETAGSNAMN] Legal company name, e.g. "FastighetsRadar AB". */
  companyName: null,
  /** [ORG_NR] e.g. "559XXX-XXXX". */
  orgNumber: null,
  /** [MOMS_NR] e.g. "SE559XXXXXXX01". */
  vatNumber: null,
  /** [GATUADRESS] */
  streetAddress: null,
  /** [POSTNR_ORT] e.g. "111 22 Stockholm". */
  postalTown: null,
  /** [SÄTE] Municipality of the registered office (decides the district court). */
  seat: null,
  /** [DOMÄN] Public domain, e.g. "fastighetsradar.se". Until set, the host of APP_URL is shown. */
  domain: null,
  /** [SUPPORT_EPOST] */
  supportEmail: null,
  /** [JURIDIK_EPOST] Privacy and legal questions. */
  legalEmail: null,
  /** [FAKTURA_EPOST] Billing questions. */
  billingEmail: null,
  /** [HOSTING_LEVERANTÖR] Where the application and database run. */
  hostingProvider: null,
  /** [SMS_LEVERANTÖR] The SMS integration in the code is 46elks. */
  smsProvider: '46elks AB (Sverige)',
  /** [FAKTURA_LEVERANTÖR] Invoicing and bookkeeping system. */
  billingProvider: null,
  /** Approved for F-skatt; `null` leaves it out of the footer. */
  fSkatt: null,
};

export type LegalField =
  | 'companyName' | 'orgNumber' | 'vatNumber' | 'streetAddress' | 'postalTown' | 'seat' | 'domain'
  | 'supportEmail' | 'legalEmail' | 'billingEmail' | 'hostingProvider' | 'smsProvider' | 'billingProvider';

export const LEGAL_PLACEHOLDERS: Record<LegalField, string> = {
  companyName: '[FÖRETAGSNAMN]',
  orgNumber: '[ORG_NR]',
  vatNumber: '[MOMS_NR]',
  streetAddress: '[GATUADRESS]',
  postalTown: '[POSTNR_ORT]',
  seat: '[SÄTE]',
  domain: '[DOMÄN]',
  supportEmail: '[SUPPORT_EPOST]',
  legalEmail: '[JURIDIK_EPOST]',
  billingEmail: '[FAKTURA_EPOST]',
  hostingProvider: '[HOSTING_LEVERANTÖR]',
  smsProvider: '[SMS_LEVERANTÖR]',
  billingProvider: '[FAKTURA_LEVERANTÖR]',
};

/** Effective date of the documents (also their version). */
export const LEGAL_EFFECTIVE_DATE = LEGAL_VERSIONS.terms;

/** The value, or its placeholder while it is missing. */
export function legalText(field: LegalField): string {
  return LEGAL_COMPANY[field] ?? LEGAL_PLACEHOLDERS[field];
}

export function isLegalFieldSet(field: LegalField): boolean {
  return Boolean(LEGAL_COMPANY[field]);
}

/** The public domain: the configured one, otherwise the host the site runs on. */
export function legalDomain(appUrl: string | undefined = process.env.APP_URL): string {
  if (LEGAL_COMPANY.domain) return LEGAL_COMPANY.domain;
  try {
    return appUrl ? new URL(appUrl).host : LEGAL_PLACEHOLDERS.domain;
  } catch {
    return LEGAL_PLACEHOLDERS.domain;
  }
}

/** Fields that still show a placeholder (docs/legal/README.md lists what goes where). */
export function missingLegalFields(): LegalField[] {
  return (Object.keys(LEGAL_PLACEHOLDERS) as LegalField[]).filter((f) => !isLegalFieldSet(f));
}
