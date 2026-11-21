import Link from 'next/link';
import { NAV_LINKS } from '@/lib/landing/content';
import { container, eyebrow } from './styles';
import css from './landing.module.css';

/** Public pages that share the marketing header and footer. */
export type SitePage = 'landing' | 'pricing';

/** In-page anchors ("#funktioner") live on the start page; from other pages they need the "/" prefix. */
const resolveHref = (href: string, page: SitePage) => (page !== 'landing' && href.startsWith('#') ? `/${href}` : href);

function NavAnchor({ href, page, className, style, current, children }: {
  href: string; page: SitePage; className?: string; style?: React.CSSProperties; current?: boolean; children: React.ReactNode;
}) {
  const target = resolveHref(href, page);
  const props = { className, style, 'aria-current': current ? ('page' as const) : undefined };
  return target.startsWith('#') ? <a href={target} {...props}>{children}</a> : <Link href={target} {...props}>{children}</Link>;
}

/** Sticky pill navigation of the public site (approved landing design, plus the "Priser" link). */
export function SiteHeader({ signedIn, page }: { signedIn: boolean; page: SitePage }) {
  return (
    <header className={css.header} style={{ position: 'sticky', top: 0, zIndex: 50, padding: '12px clamp(12px,2vw,24px) 0' }}>
      <nav
        aria-label="Huvudmeny"
        className={css.navigation}
        style={{
          maxWidth: 1320, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, padding: '8px 8px 8px 14px', borderRadius: 999,
          background: 'rgba(247,248,246,0.78)', backdropFilter: 'blur(18px) saturate(1.4)', WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
          border: '1px solid rgba(20,23,26,0.06)', boxShadow: '0 8px 24px -16px rgba(20,23,26,0.18)',
        }}
      >
        {page === 'landing' ? (
          <a href="#top" className={css.navBrand} aria-label="FastighetsRadar – till toppen" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
            <span style={{ fontWeight: 600, fontSize: 17, letterSpacing: '-0.02em' }}>FastighetsRadar</span>
          </a>
        ) : (
          <Link href="/" className={css.navBrand} aria-label="FastighetsRadar – till startsidan" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
            <span style={{ fontWeight: 600, fontSize: 17, letterSpacing: '-0.02em' }}>FastighetsRadar</span>
          </Link>
        )}
        {/* Links that do not fit wrap onto a hidden second row (design behaviour on narrow screens). */}
        <div className={css.navLinks} style={{ flex: '1 1 auto', minWidth: 0, height: 36, overflow: 'hidden', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 2 }}>
          {NAV_LINKS.map((l) => {
            const current = page === 'pricing' && l.href === '/priser';
            return (
              <NavAnchor
                key={l.href}
                href={l.href}
                page={page}
                current={current}
                className={current ? `${css.navLink} ${css.navLinkCurrent}` : css.navLink}
                style={{ height: 36, display: 'flex', alignItems: 'center', padding: '0 14px', borderRadius: 999, fontSize: 14.5 }}
              >
                {l.label}
              </NavAnchor>
            );
          })}
        </div>
        <div className={css.navAuthActions} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
          {signedIn ? (
            <Link href="/overview" className={css.primary} style={{ height: 40, display: 'flex', alignItems: 'center', padding: '0 18px', borderRadius: 999, fontSize: 14.5, fontWeight: 500, background: '#14171A' }}>
              Öppna översikten
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className={`${css.ghost} ${css.navSignIn}`} style={{ height: 40, display: 'flex', alignItems: 'center', padding: '0 16px', borderRadius: 999, fontSize: 14.5, fontWeight: 500 }}>
                Logga in
              </Link>
              <Link href="/sign-up" className={`${css.primary} ${css.navSignUp}`} style={{ height: 40, display: 'flex', alignItems: 'center', padding: '0 18px', borderRadius: 999, fontSize: 14.5, fontWeight: 500, background: '#14171A' }}>
                Skapa konto
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

const PRODUCT_LINKS = [
  { href: '#sa-fungerar-det', label: 'Så fungerar det' },
  { href: '#funktioner', label: 'Funktioner' },
  { href: '#sms', label: 'SMS-larm' },
  { href: '#data', label: 'Datakällor' },
  { href: '/priser', label: 'Priser' },
] as const;

/** Legal documents are not published yet; listed (not linked) so the footer matches the pricing design. */
const LEGAL_DOCUMENTS = ['Användarvillkor', 'Integritetspolicy', 'Cookies', 'PUB-avtal'] as const;

export function SiteFooter({ page }: { page: SitePage }) {
  const col = { display: 'flex', flexDirection: 'column' as const, gap: 12, fontSize: 14.5 };
  return (
    <footer className={css.footer} style={{ padding: '72px 0 40px' }}>
      <div style={{ ...container, display: 'flex', flexDirection: 'column', gap: 48 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 40 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 320 }}>
            <NavAnchor href={page === 'landing' ? '#top' : '/'} page="landing" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 16, letterSpacing: '-0.02em' }}>FastighetsRadar</span>
            </NavAnchor>
            <span style={{ fontSize: 14.5, lineHeight: 1.55, color: '#6B737B' }}>Miljö- och samhällsbevakning för fastigheter, byggd på svensk offentlig data.</span>
          </div>
          <nav aria-label="Sidfot" style={{ display: 'flex', flexWrap: 'wrap', gap: '28px 56px' }}>
            <div style={col}>
              <span style={eyebrow}>Produkt</span>
              {PRODUCT_LINKS.map((l) => (
                <NavAnchor key={l.href} href={l.href} page={page} className={css.footerLink}>{l.label}</NavAnchor>
              ))}
            </div>
            <div style={col}>
              <span style={eyebrow}>Konto</span>
              <Link href="/sign-up" className={css.footerLink}>Skapa konto</Link>
              <Link href="/sign-in" className={css.footerLink}>Logga in</Link>
            </div>
            <div style={col}>
              <span style={eyebrow}>Juridik</span>
              {LEGAL_DOCUMENTS.map((d) => (
                <span key={d} title="Publiceras snart">{d}</span>
              ))}
            </div>
          </nav>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, paddingTop: 22, borderTop: '1px solid rgba(20,23,26,0.08)', fontSize: 13, color: '#6B737B' }}>
          <span>© {new Date().getFullYear()} FastighetsRadar{page === 'pricing' ? ' · Alla priser anges exkl. moms' : ''}</span>
          <span>Data: SMHI, Krisinformation, Trafikverket, SGU, MCF, SCB · Kartdata © OpenStreetMap-bidragsgivare</span>
        </div>
      </div>
    </footer>
  );
}
