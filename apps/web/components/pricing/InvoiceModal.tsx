'use client';

import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  formatOrgNumber, formatSek, intervalOptions, isValidOrgNumber, ORDERING_ENABLED, orderSummary, orgDigits, PAID_PLAN_ORDER, PAID_PLANS,
  type OrderInterval, type PaidPlanId,
} from '@/lib/pricing/plans';
import { lookupOrganization, type OrganizationInfo } from '@/lib/pricing/org-lookup';
import { CheckIcon, CloseIcon } from './icons';
import css from './pricing.module.css';

type Method = 'pdf' | 'peppol';

const EMAIL_PATTERN = /.+@.+\..+/;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * "Beställ … mot faktura" – Swedish B2B invoice order (design "Fakturamodal"): organisation number with
 * company lookup, invoice interval, PDF or Peppol delivery, reference, contact and consent, next to an
 * order summary with VAT.
 *
 * Front end only: the lookup is a placeholder and submitting shows the confirmation without creating
 * an order or an invoice.
 */
export function InvoiceModal({ initialPlan, initialInterval, onClose, orderingEnabled = ORDERING_ENABLED }: {
  initialPlan: PaidPlanId; initialInterval: OrderInterval; onClose: () => void; orderingEnabled?: boolean;
}) {
  const { user } = useUser();
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const orgInputRef = useRef<HTMLInputElement>(null);

  const [plan, setPlan] = useState<PaidPlanId>(initialPlan);
  const [interval, setOrderInterval] = useState<OrderInterval>(initialInterval);
  const [planMenu, setPlanMenu] = useState(false);
  const [digits, setDigits] = useState('');
  const [found, setFound] = useState<{ digits: string; org: OrganizationInfo } | null>(null);
  const [method, setMethod] = useState<Method>('pdf');
  const [email, setEmail] = useState('');
  const [peppol, setPeppol] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [contactName, setContactName] = useState(() => user?.fullName ?? '');
  const [contactEmail, setContactEmail] = useState(() => user?.primaryEmailAddress?.emailAddress ?? '');
  const [agree, setAgree] = useState(false);
  const [done, setDone] = useState(false);

  const plans = PAID_PLANS[plan];
  const options = intervalOptions(plan);
  // Monthly invoicing exists only for Business; switching plan falls back to quarterly.
  const effectiveInterval: OrderInterval = options.some((o) => o.id === interval) ? interval : 'quarter';
  const summary = orderSummary(plan, effectiveInterval);
  const prefilledContact = Boolean(user?.fullName || user?.primaryEmailAddress);

  const orgComplete = digits.length === 10;
  const orgInvalid = orgComplete && !isValidOrgNumber(digits);
  const orgValid = orgComplete && !orgInvalid;
  const org = orgValid && found?.digits === digits ? found.org : null;
  const looking = orgValid && !org;
  const peppolValue = peppol ?? (org ? `0007:${digits}` : '');
  const company = org?.name ?? 'organisationen';
  const valid = Boolean(org) && agree && (method === 'pdf' ? EMAIL_PATTERN.test(email) : peppolValue.length > 6);

  // Simulated company lookup once ten valid digits are entered.
  useEffect(() => {
    if (!orgValid) return;
    const controller = new AbortController();
    lookupOrganization(digits, controller.signal).then((info) => setFound({ digits, org: info }), () => undefined);
    return () => controller.abort();
  }, [digits, orgValid]);

  // Modal behaviour: lock page scroll and move focus into the dialog; restore both on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  // Escape closes; Tab stays inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid && orderingEnabled) setDone(true);
  };
  const clearOrg = () => {
    setDigits('');
    setPeppol(null);
    orgInputRef.current?.focus();
  };

  return createPortal(
    <div className={css.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={css.overlayInner}>
        <div ref={dialogRef} className={css.modal} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}>
          <div className={css.modalHead}>
            <div>
              <span className={css.modalPill}><span className={css.dot} />Svensk företagsfaktura</span>
              <h2 id={`${id}-title`} className={css.modalTitle}>Beställ {plans.name} mot faktura</h2>
              <p className={css.modalLead}>Inget kort krävs. Ange ert organisationsnummer så hämtar vi företagsuppgifterna automatiskt.</p>
            </div>
            <button type="button" className={css.closeButton} onClick={onClose} aria-label="Stäng"><CloseIcon /></button>
          </div>

          <div className={css.modalBody}>
            <div className={css.formCol}>
              {done ? (
                <div className={css.done} role="status">
                  <span className={css.doneIcon}><CheckIcon size={24} color="#1E6B41" /></span>
                  <h3 className={css.doneTitle}>{plans.name} är aktiverat för {company}</h3>
                  <p className={css.doneText}>
                    Fakturan på {formatSek(summary.grossSek)} inkl. moms skickas till {method === 'pdf' ? email : `Peppol-ID ${peppolValue}`} med 30 dagars betalningstid. Alla {plans.name}-funktioner är tillgängliga redan nu.
                  </p>
                  <Link href="/overview" className={`${css.btnPrimary} ${css.doneButton}`}>Till portföljöversikten</Link>
                </div>
              ) : (
                <form className={css.form} onSubmit={submit} noValidate>
                  <div className={css.field}>
                    <label htmlFor={`${id}-org`} className={css.label}>Organisationsnummer</label>
                    <input
                      ref={orgInputRef}
                      id={`${id}-org`}
                      className={`${css.input} ${css.inputOrg}`}
                      value={formatOrgNumber(digits)}
                      onChange={(e) => {
                        setDigits(orgDigits(e.target.value));
                        setPeppol(null);
                      }}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="559XXX-XXXX eller 7696XX-XXXX"
                      aria-invalid={orgInvalid || undefined}
                      aria-describedby={orgInvalid ? `${id}-org-error` : undefined}
                    />
                    {orgInvalid && <span id={`${id}-org-error`} className={css.error}>Kontrollera numret – kontrollsiffran stämmer inte.</span>}
                    <div aria-live="polite">
                      {looking && <div className={css.lookup}><span />Hämtar företagsuppgifter…</div>}
                      {org && (
                        <div className={css.verified}>
                          <span className={css.verifiedIcon}><CheckIcon size={12} strokeWidth={2} color="#FFFFFF" /></span>
                          <div className={css.verifiedText}><strong>{org.name}</strong> · {org.address}</div>
                          <button type="button" className={css.smallButton} onClick={clearOrg}>Ändra</button>
                        </div>
                      )}
                    </div>
                  </div>

                  <fieldset className={css.field}>
                    <legend className={css.label} style={{ marginBottom: 8 }}>Faktureringsintervall</legend>
                    <div className={css.radioGrid}>
                      {options.map((o) => (
                        <label key={o.id} className={css.radioCard}>
                          <input type="radio" name={`${id}-interval`} value={o.id} checked={o.id === effectiveInterval} onChange={() => setOrderInterval(o.id)} />
                          <span className={css.radioRing} />
                          <span className={css.radioText}>
                            <span className={css.radioLabel}>{o.label}</span>
                            <span className={css.radioPrice}>{o.price}</span>
                            {o.badge && <span className={css.radioBadge}>{o.badge}</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className={css.field} style={{ gap: 10 }}>
                    <span id={`${id}-method`} className={css.label}>Hur vill ni ta emot fakturan?</span>
                    <div className={css.segment} role="radiogroup" aria-labelledby={`${id}-method`}>
                      <button type="button" role="radio" aria-checked={method === 'pdf'} className={css.segmentOption} onClick={() => setMethod('pdf')}>PDF via e-post</button>
                      <button type="button" role="radio" aria-checked={method === 'peppol'} className={css.segmentOption} onClick={() => setMethod('peppol')}>E-faktura (Peppol)</button>
                    </div>
                    {method === 'pdf' ? (
                      <div className={css.methodField}>
                        <label htmlFor={`${id}-email`} className={css.subLabel}>Faktura-e-post</label>
                        <input
                          id={`${id}-email`} type="email" className={css.input} value={email} onChange={(e) => setEmail(e.target.value)}
                          placeholder="t.ex. faktura@foretaget.se eller er skanningsadress hos Nabo/Fortnox" autoComplete="email"
                        />
                      </div>
                    ) : (
                      <div className={css.methodField}>
                        <label htmlFor={`${id}-peppol`} className={css.subLabel}>Peppol-ID / GLN</label>
                        <input
                          id={`${id}-peppol`} className={`${css.input} ${css.inputMono}`} value={peppolValue} onChange={(e) => setPeppol(e.target.value)}
                          placeholder="0007:XXXXXXXXXX" autoComplete="off" aria-describedby={`${id}-peppol-help`}
                        />
                        <span id={`${id}-peppol-help`} className={css.help}>
                          {peppol == null && org ? 'Förifyllt utifrån organisationsnumret – ändra om ni har ett annat ID.' : 'Format 0007:organisationsnummer eller GLN.'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className={css.field}>
                    <label htmlFor={`${id}-ref`} className={css.label}>Er referens / Märkning<span className={css.optional}>Valfritt</span></label>
                    <input id={`${id}-ref`} className={css.input} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="t.ex. Kostnadsställe, förvaltare eller styrelsenamn" />
                  </div>

                  <fieldset className={css.field}>
                    <legend className={css.label} style={{ marginBottom: 8 }}>Kontaktperson för abonnemanget</legend>
                    <div className={css.contactGrid}>
                      <input className={css.input} value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Namn" aria-label="Namn" autoComplete="name" />
                      <input className={css.input} type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="E-post" aria-label="E-post" autoComplete="email" />
                    </div>
                    {prefilledContact && <span className={css.help}>Förifyllt från ditt konto.</span>}
                  </fieldset>

                  <div className={css.formDivider} />

                  <label className={css.agree}>
                    <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                    <span className={css.checkbox}><CheckIcon size={12} strokeWidth={2.2} color="#FFFFFF" /></span>
                    <span>
                      Jag har behörighet att beställa för {company} och godkänner att abonnemanget faktureras i förskott (30 dagars betalningstid) enligt{' '}
                      <span className={css.underline}>Användarvillkoren</span> och <span className={css.underline}>PUB-avtalet</span>.
                    </span>
                  </label>

                  {orderingEnabled ? (
                    <button type="submit" className={`${css.btnPrimary} ${css.submit}`} disabled={!valid}>Aktivera {plans.name} mot faktura</button>
                  ) : (
                    <div className={css.field}>
                      <button type="submit" className={`${css.btnPrimary} ${css.submit}`} disabled aria-describedby={`${id}-soon`}>Beställning öppnar snart</button>
                      <span id={`${id}-soon`} className={css.help} style={{ textAlign: 'center' }}>Beställning mot faktura öppnar inom kort – inget skickas eller faktureras nu.</span>
                    </div>
                  )}
                </form>
              )}
            </div>

            <aside className={css.summaryCol} aria-label="Ordersammanfattning">
              <div className={css.summary}>
                <span className={css.summaryEyebrow}>Ordersammanfattning</span>
                <div className={css.summaryPlan}>
                  <div>
                    <span className={css.muted} style={{ fontSize: 13 }}>Vald plan</span>
                    <span className={css.summaryPlanName}>FastighetsRadar {plans.name}</span>
                  </div>
                  <button type="button" className={`${css.linkButton} ${css.summaryLink}`} aria-expanded={planMenu} onClick={() => setPlanMenu((v) => !v)}>Byt plan</button>
                </div>
                {planMenu && (
                  <div className={css.planChips} role="radiogroup" aria-label="Plan">
                    {PAID_PLAN_ORDER.map((p) => (
                      <button
                        key={p} type="button" role="radio" aria-checked={p === plan} className={css.planChip}
                        onClick={() => { setPlan(p); setPlanMenu(false); setDone(false); }}
                      >
                        {PAID_PLANS[p].name}
                      </button>
                    ))}
                  </div>
                )}
                <span className={css.summaryIncludes}>{plans.includes}</span>
                <dl className={css.summaryLines}>
                  <div><dt>Period</dt><dd>{summary.interval.period}</dd></div>
                  <div><dt>Summa exkl. moms</dt><dd>{formatSek(summary.netSek)}</dd></div>
                  <div><dt>Moms (25 %)</dt><dd>{formatSek(summary.vatSek)}</dd></div>
                </dl>
                <div className={css.summaryTotal}>
                  <span>Att betala på faktura</span>
                  <span>{formatSek(summary.grossSek)}</span>
                </div>
                <ul className={css.assurances}>
                  {['Tillgång direkt idag', 'Faktura skickas med 30 dagar netto', 'Inget kort krävs'].map((t) => (
                    <li key={t}><CheckIcon size={14} strokeWidth={1.8} color="#2E9E5B" />{t}</li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
