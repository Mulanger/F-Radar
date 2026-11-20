'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore, type ReactNode } from 'react';
import { AUTH_LINKS } from '@/lib/auth/links';
import { AuthScene } from './AuthScene';
import s from './AuthShell.module.css';

const MOBILE_QUERY = '(max-width: 819.98px)';

function subscribeMobile(onChange: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function useIsMobile() {
  return useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE_QUERY).matches, () => false);
}

/**
 * Shared frame for /sign-in and /sign-up. It lives in the `(auth)` route-group layout, so
 * switching between the two keeps the same 3D scene and animates the mobile panel height.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const mode = pathname.startsWith('/sign-up') ? 'signup' : 'login';
  const mobile = useIsMobile();
  const sceneOptions = {
    extras: true,
    speed: 1,
    zoom: mobile ? (mode === 'signup' ? 0.9 : 1.0) : 1.38,
    offsetY: mobile ? 0 : -0.05,
  };

  return (
    <div className={s.root}>
      <div className={s.card}>
        <div className={s.form}>
          <header className={s.header}>
            <Link href="/" className={s.brand}>FastighetsRadar</Link>
            <Link href="/" className={s.back}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 12H5M11 6l-6 6 6 6" />
              </svg>
              Till startsidan
            </Link>
          </header>

          <main className={s.main}>
            <div className={s.inner}>{children}</div>
          </main>

          <footer className={s.footer}>
            <span>Säker inloggning via Clerk</span>
            <nav aria-label="Juridiskt och datakällor">
              {AUTH_LINKS.terms ? <Link href={AUTH_LINKS.terms}>Villkor</Link> : <span>Villkor</span>}
              {AUTH_LINKS.privacy ? <Link href={AUTH_LINKS.privacy}>Integritet</Link> : <span>Integritet</span>}
              <Link href={AUTH_LINKS.dataSources}>Datakällor</Link>
            </nav>
          </footer>
        </div>

        <div className={s.panel} data-mode={mode}>
          <AuthScene options={sceneOptions} className={s.scene} />
          <span className={s.pill}>FastighetsRadar</span>
        </div>
      </div>
    </div>
  );
}
