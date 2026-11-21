/**
 * Price list and copy for the public pricing page (`/priser`) and the invoice order modal, from the
 * approved design "Prissida – desktop och mobil" and its brief. All prices are in SEK excluding VAT.
 *
 * Presentation only: nothing here creates subscriptions or invoices. Checkout logic comes later.
 */

export type BillingInterval = 'year' | 'quarter';
/** Business (and Enterprise) can also be invoiced monthly; the page toggle only offers year/quarter. */
export type OrderInterval = BillingInterval | 'month';
export type PaidPlanId = 'start' | 'pro' | 'business';

export const VAT_RATE = 0.25;

/**
 * Invoice ordering has no backend yet. While false the order modal can be filled in but not submitted,
 * so no visitor believes an order was placed. Turn on together with the checkout logic.
 */
export const ORDERING_ENABLED = false;
export const ENTERPRISE_FROM_SEK = 2990;

export interface PaidPlan {
  id: PaidPlanId;
  name: string;
  /** One-line summary for the order summary. */
  includes: string;
  yearSek: number;
  quarterSek: number;
  monthSek?: number;
}

export const PAID_PLANS: Record<PaidPlanId, PaidPlan> = {
  start: { id: 'start', name: 'Start', includes: 'Upp till 5 fastigheter · 50 SMS/mån · 3 användare', yearSek: 2490, quarterSek: 747 },
  pro: { id: 'pro', name: 'Pro', includes: 'Upp till 20 fastigheter · 200 SMS/mån · 10 användare', yearSek: 6900, quarterSek: 2070 },
  business: {
    id: 'business', name: 'Business', includes: 'Upp till 50 fastigheter · 500 SMS/mån · obegränsat antal användare',
    yearSek: 14900, quarterSek: 4470, monthSek: 1490,
  },
};
export const PAID_PLAN_ORDER: PaidPlanId[] = ['start', 'pro', 'business'];

const NBSP = ' ';

/**
 * Swedish number format with a non-breaking thin grouping space and decimal comma ("14 900", "186,75").
 * Hand-rolled instead of `toLocaleString` so server and browser always render identical text.
 */
export function formatNumber(value: number): string {
  const negative = value < 0;
  const cents = Math.round(Math.abs(value) * 100);
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return (negative ? '-' : '') + grouped + (fraction ? ',' + String(fraction).padStart(2, '0') : '');
}

export const formatSek = (value: number): string => `${formatNumber(value)}${NBSP}kr`;

/** Monthly equivalent shown on the cards: yearly price / 12 (rounded) or quarterly price / 3. */
export function monthlyPriceSek(plan: PaidPlanId, interval: BillingInterval): number {
  const p = PAID_PLANS[plan];
  return interval === 'year' ? Math.round(p.yearSek / 12) : Math.round(p.quarterSek / 3);
}

/** Line under the card price that says what is actually invoiced. */
export function billingNote(plan: PaidPlanId, interval: BillingInterval): string {
  const p = PAID_PLANS[plan];
  if (interval === 'year') return `Faktureras årsvis (${formatSek(p.yearSek)}/år exkl. moms)`;
  const quarter = `${formatSek(p.quarterSek)}/kvartal exkl. moms`;
  return p.monthSek ? `Kvartals- eller månadsfaktura (${quarter})` : `Faktureras kvartalsvis (${quarter})`;
}

export interface IntervalOption {
  id: OrderInterval;
  label: string;
  price: string;
  period: string;
  netSek: number;
  badge?: string;
}

/** Invoice intervals a plan can be ordered with (month only where the plan has a monthly price). */
export function intervalOptions(plan: PaidPlanId): IntervalOption[] {
  const p = PAID_PLANS[plan];
  const options: IntervalOption[] = [
    { id: 'year', label: 'Årsfaktura', price: `${formatSek(p.yearSek)}/år exkl. moms`, period: '12 månader (Årsfaktura)', netSek: p.yearSek, badge: 'Spara 2 månader' },
    { id: 'quarter', label: 'Kvartalsfaktura', price: `${formatSek(p.quarterSek)}/kvartal exkl. moms`, period: '3 månader (Kvartalsfaktura)', netSek: p.quarterSek },
  ];
  if (p.monthSek) options.push({ id: 'month', label: 'Månadsfaktura', price: `${formatSek(p.monthSek)}/mån exkl. moms`, period: '1 månad (Månadsfaktura)', netSek: p.monthSek });
  return options;
}

export interface OrderSummary {
  interval: IntervalOption;
  netSek: number;
  vatSek: number;
  grossSek: number;
}

/** Net, VAT (25 %, rounded to öre) and total for one invoice period. Unknown intervals fall back to yearly. */
export function orderSummary(plan: PaidPlanId, interval: OrderInterval): OrderSummary {
  const options = intervalOptions(plan);
  const chosen = options.find((o) => o.id === interval) ?? options[0]!;
  const netSek = chosen.netSek;
  const vatSek = Math.round(netSek * VAT_RATE * 100) / 100;
  return { interval: chosen, netSek, vatSek, grossSek: Math.round((netSek + vatSek) * 100) / 100 };
}

/* Swedish organisation numbers ------------------------------------------------ */

export const orgDigits = (input: string): string => input.replace(/\D/g, '').slice(0, 10);

/** "5591234567" → "559123-4567" while typing. */
export const formatOrgNumber = (digits: string): string => (digits.length > 6 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : digits);

/** Ten digits with a valid Luhn check digit (the same check Bolagsverket uses). */
export function isValidOrgNumber(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(digits[i]) * (i % 2 === 0 ? 2 : 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

/* Page content ------------------------------------------------------------------ */

export interface Badge {
  label: string;
  bg: string;
  fg: string;
}
const BADGE = {
  neutral: { bg: '#EEEEEA', fg: '#40454B' },
  blue: { bg: '#E3EBF8', fg: '#2B528F' },
  green: { bg: '#DCF2E3', fg: '#1E6B41' },
} as const;

export type PlanCta =
  | { kind: 'signup'; label: string; note: string }
  | { kind: 'trial'; label: string }
  | { kind: 'order'; label: string; note: string };

export interface PlanCard {
  id: 'free' | PaidPlanId;
  name: string;
  tagline: string;
  badge: Badge;
  featured?: boolean;
  cta: PlanCta;
  features: { text: string; aside?: string }[];
}

export const PLAN_CARDS: PlanCard[] = [
  {
    id: 'free', name: 'Gratis', tagline: 'Utforska på din första adress.', badge: { label: 'Kom igång', ...BADGE.neutral },
    cta: { kind: 'signup', label: 'Skapa gratiskonto', note: 'Inget kort eller faktura krävs' },
    features: [
      { text: '1 bevakad fastighet' },
      { text: 'Live-data från SMHI, Krisinformation, Trafikverket, SGU m.fl.' },
      { text: 'Riskindex & 48-timmarsprognos (halka, vind, regn)' },
      { text: 'SMS-regler i testläge / simulering' },
      { text: '1 användare' },
    ],
  },
  {
    id: 'start', name: 'Start', tagline: 'För BRF:er och mindre fastighetsägare.', badge: { label: 'För BRF & småägare', ...BADGE.blue },
    cta: { kind: 'trial', label: 'Starta 14 dagar fritt' },
    features: [
      { text: 'Upp till 5 bevakade fastigheter' },
      { text: 'Skarpa SMS-larm (50 SMS/mån ingår)' },
      { text: 'Upp till 3 SMS-mottagare & 3 användare' },
      { text: 'Egna tysta timmar & dagliga gränser' },
      { text: 'Kvitteringar & PDF-export (12 mån historik)' },
    ],
  },
  {
    id: 'pro', name: 'Pro', tagline: 'För fastighetsbolag och lokala skötare.', badge: { label: '14 dagar fritt', ...BADGE.green }, featured: true,
    cta: { kind: 'trial', label: 'Starta 14 dagar fritt' },
    features: [
      { text: 'Upp till 20 bevakade fastigheter', aside: '(+5 st som tillägg)' },
      { text: 'Skarpa SMS-larm (200 SMS/mån ingår)' },
      { text: 'Upp till 10 SMS-mottagare & 10 användare' },
      { text: 'Portföljgrupper (t.ex. per område eller kund)' },
      { text: 'Obegränsad kvitteringshistorik & PDF-rapporter' },
    ],
  },
  {
    id: 'business', name: 'Business', tagline: 'För förvaltningsbolag och större driftteam.', badge: { label: 'För förvaltare', ...BADGE.neutral },
    cta: { kind: 'order', label: 'Beställ mot faktura', note: 'Inget kort krävs · 30 dagar netto' },
    features: [
      { text: 'Upp till 50 bevakade fastigheter' },
      { text: 'Skarpa SMS-larm (500 SMS/mån ingår)' },
      { text: 'Upp till 25 SMS-mottagare & obegränsat antal användare' },
      { text: 'Anpassad trafikradie per enskild fastighet' },
      { text: 'E-faktura (Peppol) & prioriterad support' },
    ],
  },
];

export const ENTERPRISE_TAGS = ['Flera organisationer', 'API & webhooks', 'SLA & kundansvarig', 'Anpassad SMS-volym'] as const;

export const ADD_ONS = [
  {
    title: 'Extra fastigheter (i Pro)', price: '+5 st · 190 kr/mån',
    text: 'Exkl. moms. För portföljer som växer mellan nivåerna – t.ex. 23 fastigheter utan att behöva gå upp till Business.',
  },
  {
    title: 'Extra SMS-volym', price: '200 SMS · 199 kr',
    text: 'Eller 1 kr per extra SMS-del. Välj att pausa SMS automatiskt eller fylla på – dina egna dagliga maxgränser skyddar alltid kostnaden.',
  },
] as const;

export type TrustIcon = 'building' | 'calendar' | 'file' | 'messages';
export const TRUST_POINTS: { icon: TrustIcon; title: string; text: string }[] = [
  { icon: 'building', title: 'Inget företagskort krävs', text: 'Uppgradera på 30 sekunder med ert organisationsnummer. Vi hämtar företagsuppgifterna automatiskt.' },
  { icon: 'calendar', title: '30 dagars betalningstid', text: 'Anpassat för styrelseattestering i BRF och ekonomiavdelningar. Kom igång direkt när ni beställer.' },
  { icon: 'file', title: 'PDF-faktura & e-faktura (Peppol)', text: 'Ange er faktura-e-post (t.ex. Nabo, SBC, HSB eller Fortnox) och egen märkning direkt vid beställning.' },
  { icon: 'messages', title: 'Samlade SMS utan överraskningar', text: 'Flera fastigheter i samma varning kan samlas i ett enda SMS, och era dagliga tak skyddar alltid budgeten.' },
];

/** Comparison matrix: `true` = included, `false` = not included, string = value. Columns: Gratis, Start, Pro, Business, Enterprise. */
export type CompareCell = boolean | string;
export interface CompareCategory {
  id: string;
  title: string;
  rows: { label: string; cells: [CompareCell, CompareCell, CompareCell, CompareCell, CompareCell] }[];
}
const Y = true;
const N = false;
export const COMPARE_COLUMNS = ['Gratis', 'Start', 'Pro', 'Business', 'Enterprise'] as const;
/** Index of the highlighted column (Pro). */
export const FEATURED_COLUMN = 2;

export const COMPARISON: CompareCategory[] = [
  {
    id: 'portfolj', title: 'Portfölj & data', rows: [
      { label: 'Antal bevakade fastigheter', cells: ['1', 'Upp till 5', 'Upp till 20', 'Upp till 50', '50+ (anpassat)'] },
      { label: 'Tillägg extra fastigheter', cells: [N, N, '+5 st / 190 kr mån', 'Enligt avtal', 'Enligt avtal'] },
      { label: 'SMHI vädervarningar & punktprognos', cells: [Y, Y, Y, Y, Y] },
      { label: 'VMA & lokal krisinformation', cells: [Y, Y, Y, Y, Y] },
      { label: 'Vattenstånd, översvämningszon & grundvatten', cells: [Y, Y, Y, Y, Y] },
      { label: 'Trafikverket-händelser (100 m – 3 km)', cells: [Y, Y, Y, Y, Y] },
      { label: 'Luftkvalitet & 48 h-prognos (halka/frost/vind)', cells: [Y, Y, Y, Y, Y] },
      { label: 'Samlad fastighetsrisk (Riskindex)', cells: [Y, Y, Y, Y, Y] },
      { label: 'Portföljkarta & nederbördsradar', cells: [Y, Y, Y, Y, Y] },
      { label: 'Portföljgrupper / områden', cells: [N, N, Y, Y, Y] },
      { label: 'Individuell larmradie per fastighet', cells: [N, N, N, Y, Y] },
    ],
  },
  {
    id: 'sms', title: 'SMS-larm & regler', rows: [
      { label: 'SMS-regler i testläge / simulering', cells: [Y, Y, Y, Y, Y] },
      { label: 'Skarpa SMS-utskick per månad', cells: [N, '50 st', '200 st', '500 st', 'Anpassat'] },
      { label: 'Verifierade SMS-mottagare', cells: [N, 'Upp till 3', 'Upp till 10', 'Upp till 25', 'Obegränsat'] },
      { label: 'Tysta timmar & undantag för röd varning/VMA', cells: [N, Y, Y, Y, Y] },
      { label: 'Samla flera fastigheter i ett SMS', cells: [N, Y, Y, Y, Y] },
      { label: 'Extra SMS vid överskriden kvot', cells: [N, '1 kr/del el. paket', '1 kr/del el. paket', '1 kr/del el. paket', 'Anpassat'] },
    ],
  },
  {
    id: 'team', title: 'Team & dokumentation', rows: [
      { label: 'Antal inloggade användare', cells: ['1', 'Upp till 3', 'Upp till 10', 'Obegränsat', 'Obegränsat'] },
      { label: 'Kvittering av larm & händelser', cells: [Y, Y, Y, Y, Y] },
      { label: 'PDF-export av kvitteringshistorik', cells: [N, '12 mån historik', 'Full historik', 'Full historik', 'Full historik'] },
      { label: 'Flera organisationer / kundportföljer', cells: [N, N, N, N, Y] },
      { label: 'API & webhooks', cells: [N, N, N, N, Y] },
    ],
  },
  {
    id: 'fakturering', title: 'Fakturering & support', rows: [
      { label: 'Svensk företagsfaktura (30 dagar netto)', cells: [N, 'År / Kvartal', 'År / Kvartal', 'År / Kvartal / Mån', 'Anpassat'] },
      { label: 'E-faktura (Peppol) & egen märkning', cells: [N, Y, Y, Y, Y] },
      { label: 'Support', cells: ['E-post', 'E-post', 'Prioriterad e-post', 'Prioriterad e-post/tel', 'Dedikerad & SLA'] },
    ],
  },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Vad räknas som en fastighet?',
    a: 'En fastighet är en sparad adress eller kartposition i FastighetsRadar. Du betalar inget extra baserat på hur många lägenheter, trappuppgångar eller lokaler som finns på adressen – ett helt flerbostadshus med 120 lägenheter räknas som 1 fastighet.',
  },
  {
    q: 'Hur fungerar fakturering för BRF:er och fastighetsbolag?',
    a: 'Du behöver inget företagskort. När du uppgraderar anger du bara ert organisationsnummer, så hämtar vi företagsnamn och adress automatiskt. Du kan ange er ekonomiska förvaltares faktura-e-post (t.ex. Nabo, SBC, HSB eller Fortnox) eller Peppol-ID samt egen referens/märkning. Fakturan skickas med 30 dagars betalningstid och kontot uppgraderas direkt.',
  },
  {
    q: 'Varför ska vi betala när SMHI och Krisinformation är gratis?',
    a: 'Gratisappar är byggda för privatpersoner på en plats åt gången. FastighetsRadar ger hela driftteamet en risksorterad portföljöversikt över alla era adresser samtidigt, filtrerar bort ovidkommande brus, varnar automatiskt via SMS enligt era egna regler och tysta timmar – och låter er exportera kvitterade händelser som PDF till styrelse eller försäkringsbolag.',
  },
  {
    q: 'Vad händer om vi använder upp våra inkluderade SMS en stormig månad?',
    a: 'Du får aldrig en chockfaktura. Ni styr själva max antal SMS per fastighet och dag, och kan samla samma vädervarning för flera fastigheter i ett enda SMS. Om er månadskvot ändå tar slut kan ni välja mellan att automatiskt köpa påfyllning (199 kr för 200 SMS eller 1 kr/SMS-del) eller pausa utskick tills nästa månad.',
  },
  {
    q: 'Hur fungerar 14 dagars fri provperiod?',
    a: 'När du skapar ett konto kan du testa Pro-funktionerna i 14 dagar helt gratis (upp till 10 fastigheter och upp till 10 riktiga test-SMS). Ingen faktura skickas automatiskt när provperioden tar slut – du väljer själv om du vill beställa ett abonnemang eller fortsätta gratis med 1 fastighet.',
  },
  {
    q: 'Vilken bindningstid och uppsägningstid gäller?',
    a: 'Abonnemanget löper per vald faktureringsperiod (årsvis eller kvartalsvis) och förlängs automatiskt om det inte sägs upp senast 30 dagar före periodens slut. Du kan alltid uppgradera till en större nivå direkt i appen och betalar då bara mellanskillnaden.',
  },
];

/**
 * Where "Begär offert" / "Kontakta oss" lead. No sales address or contact form exists yet, so this is
 * a placeholder until one is decided.
 */
export const SALES_CONTACT_HREF = '#kontakt';
