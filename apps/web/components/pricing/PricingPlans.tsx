'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import {
  ADD_ONS, billingNote, ENTERPRISE_FROM_SEK, ENTERPRISE_TAGS, formatSek, monthlyPriceSek, PLAN_CARDS, SALES_CONTACT_HREF, TRUST_POINTS,
  type BillingInterval, type PaidPlanId, type PlanCard,
} from '@/lib/pricing/plans';
import { CheckIcon, TrustIcon } from './icons';
import { CompareTable } from './CompareTable';
import { InvoiceModal } from './InvoiceModal';
import css from './pricing.module.css';

export interface PlanOrder {
  plan: PaidPlanId;
  interval: BillingInterval;
}

/**
 * Hero, plan cards, add-ons, invoicing assurances and the comparison table. They share one billing
 * toggle (yearly is the default), and "Beställ mot faktura" opens the invoice order modal.
 */
export function PricingPlans({ signedIn }: { signedIn: boolean }) {
  const [interval, setBillingInterval] = useState<BillingInterval>('year');
  const [order, setOrder] = useState<PlanOrder | null>(null);
  const startHref = signedIn ? '/overview' : '/sign-up';
  const openOrder = (plan: PaidPlanId) => setOrder({ plan, interval });
  const closeOrder = useCallback(() => setOrder(null), []);

  return (
    <>
      <div className={css.heroWrap}>
        <header className={css.hero}>
          <span className={css.heroPill}><span className={css.dot} />Svensk företagsfaktura · 14 dagar fritt</span>
          <h1 className={css.h1}>Enkel prissättning för hela portföljen.</h1>
          <p className={css.heroLead}>
            Börja gratis på en fastighet eller prova Pro fritt i 14 dagar. Ingen hårdvara, inga sensorer och inget företagskort krävs – vi fakturerar smidigt mot organisationsnummer.
          </p>
          <BillingToggle value={interval} onChange={setBillingInterval} className={css.heroToggle} withBadge />
          <p className={css.heroNote}>Alla priser anges exkl. moms. 1 fastighet = 1 bevakad adress, oavsett antal lägenheter eller lokaler.</p>
        </header>
      </div>

      <section className={css.plans} aria-label="Prisnivåer">
        <div className={css.cardGrid}>
          {PLAN_CARDS.map((card) => (
            <PlanCardView key={card.id} card={card} interval={interval} startHref={startHref} onOrder={openOrder} />
          ))}
        </div>
        <Enterprise />
        <AddOns />
      </section>

      <section className={css.section} aria-labelledby="fakturering-rubrik">
        <span className={css.eyebrow}>Svensk fakturering</span>
        <h2 id="fakturering-rubrik" className={css.h2} style={{ maxWidth: 720 }}>Beställ som ni är vana. Mot faktura.</h2>
        <div className={css.trustGrid}>
          {TRUST_POINTS.map((t) => (
            <div key={t.title} className={css.trustCard}>
              <span className={css.trustIcon}><TrustIcon name={t.icon} /></span>
              <h3 className={css.trustTitle}>{t.title}</h3>
              <p className={css.trustText}>{t.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="jamfor" className={css.section} aria-labelledby="jamfor-rubrik">
        <div className={css.compareHead}>
          <div>
            <span className={css.eyebrow}>Jämför nivåer</span>
            <h2 id="jamfor-rubrik" className={css.h2}>Allt som ingår, sida vid sida.</h2>
          </div>
          <BillingToggle value={interval} onChange={setBillingInterval} small />
        </div>
        <div className={css.swipeHint} aria-hidden="true">Svep i sidled för att jämföra alla nivåer <span>→</span></div>
        <CompareTable interval={interval} />
      </section>

      {order && <InvoiceModal key={`${order.plan}-${order.interval}`} initialPlan={order.plan} initialInterval={order.interval} onClose={closeOrder} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

function BillingToggle({ value, onChange, className, small, withBadge }: {
  value: BillingInterval; onChange: (v: BillingInterval) => void; className?: string; small?: boolean; withBadge?: boolean;
}) {
  const option = (id: BillingInterval, label: string, badge?: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === id}
      onClick={() => onChange(id)}
      className={badge ? `${css.toggleOption} ${css.toggleOptionWithBadge}` : css.toggleOption}
    >
      {label}
      {badge && <span className={css.saveBadge}>{badge}</span>}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Faktureringsintervall" className={[css.toggle, small && css.toggleSmall, className].filter(Boolean).join(' ')}>
      {option('year', 'Årsfaktura', withBadge ? '2 mån gratis' : undefined)}
      {option('quarter', 'Kvartalsfaktura')}
    </div>
  );
}

function PriceTag({ amount }: { amount: string }) {
  return (
    <div className={css.priceRow}>
      <span className={css.price}>{amount}</span>
      <span className={css.priceUnit}><span>/mån</span><span>exkl. moms</span></span>
    </div>
  );
}

function PlanCardView({ card, interval, startHref, onOrder }: {
  card: PlanCard; interval: BillingInterval; startHref: string; onOrder: (plan: PaidPlanId) => void;
}) {
  const paid = card.id === 'free' ? null : card.id;
  const { cta } = card;
  return (
    <article className={card.featured ? `${css.card} ${css.cardFeatured}` : css.card} aria-labelledby={`plan-${card.id}`}>
      <div className={css.cardTop}>
        <span className={css.badge} style={{ background: card.badge.bg, color: card.badge.fg }}>{card.badge.label}</span>
        {card.featured && <span className={`${css.badge} ${css.badgeDark}`}>Mest populär</span>}
      </div>
      <h3 id={`plan-${card.id}`} className={css.planName}>{card.name}</h3>
      <p className={css.tagline}>{card.tagline}</p>
      <PriceTag amount={formatSek(paid ? monthlyPriceSek(paid, interval) : 0)} />
      <div className={css.billNote}>{paid ? billingNote(paid, interval) : 'Alltid gratis – ingen faktura'}</div>

      {cta.kind === 'order' && paid ? (
        <button type="button" className={`${css.btnSecondary} ${css.cardCta}`} onClick={() => onOrder(paid)}>{cta.label}</button>
      ) : (
        <Link href={startHref} className={`${card.featured ? css.btnPrimary : css.btnSecondary} ${css.cardCta}`}>{cta.label}</Link>
      )}
      <div className={css.ctaNote}>
        {cta.kind === 'trial' && paid ? (
          <>eller <button type="button" className={css.linkButton} onClick={() => onOrder(paid)}>beställ direkt mot faktura</button></>
        ) : cta.kind !== 'trial' ? cta.note : null}
      </div>

      <div className={css.divider} />
      <ul className={css.features}>
        {card.features.map((f) => (
          <li key={f.text} className={css.feature}>
            <CheckIcon />
            <span>{f.text}{f.aside && <> <span className={css.featureAside}>{f.aside}</span></>}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function Enterprise() {
  return (
    <article className={css.enterprise} aria-labelledby="plan-enterprise">
      <div className={css.enterpriseText}>
        <div className={css.enterpriseMeta}>
          <span className={css.badge} style={{ background: '#EEEEEA', color: '#40454B' }}>Enterprise</span>
          <span>50+ fastigheter</span>
        </div>
        <h3 id="plan-enterprise" className={css.enterpriseTitle}>Förvaltar ni fler än 50 fastigheter?</h3>
        <p className={css.enterpriseLead}>
          För allmännytta, riksförvaltare och större fastighetsbestånd erbjuder vi skräddarsydda avtal med flera organisationer, anpassad SMS-volym, API/webhooks och SLA.
        </p>
        <div className={css.tags}>
          {ENTERPRISE_TAGS.map((t) => <span key={t} className={css.tag}>{t}</span>)}
        </div>
      </div>
      <div className={css.enterprisePrice}>
        <span className={css.muted}>Från</span>
        <PriceTag amount={formatSek(ENTERPRISE_FROM_SEK)} />
        <span className={css.enterpriseTerms}>Enligt offert · Års-, kvartals- eller månadsfaktura</span>
        <a href={SALES_CONTACT_HREF} className={`${css.btnSecondary} ${css.enterpriseCta}`}>Begär offert <span aria-hidden="true">→</span></a>
      </div>
    </article>
  );
}

function AddOns() {
  return (
    <div className={css.addons}>
      <div className={css.addonsIntro}>
        <span className={css.eyebrow}>Tillägg</span>
        <span>Väx utan att byta nivå.</span>
      </div>
      <div className={css.addonsGrid}>
        {ADD_ONS.map((a) => (
          <div key={a.title} className={css.addon}>
            <div className={css.addonHead}>
              <span className={css.addonTitle}>{a.title}</span>
              <span className={css.addonPrice}>{a.price}</span>
            </div>
            <p className={css.addonText}>{a.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
