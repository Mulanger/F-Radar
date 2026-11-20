import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { IconArrowLeft } from '../ui/icons';
import { CredentialScene } from './CredentialScene';
import s from './CredentialFrame.module.css';

export function CredentialLoading() {
  return <p className={s.loading} role="status">Laddar formuläret…</p>;
}

export function CredentialFrame({ children }: { children: ReactNode }) {
  return (
    <main className={s.page}>
      <div className={s.shell}>
        <header className={s.header}>
          <Link href="/" className={s.brand}>FastighetsRadar</Link>
          <Link href="/" className={s.back}><IconArrowLeft size={16} />Till startsidan</Link>
        </header>
        <div className={s.content}>
          <div className={s.formColumn}>
            <Suspense fallback={<CredentialLoading />}>{children}</Suspense>
          </div>
        </div>
        <div className={s.visual} aria-hidden="true">
          <div className={s.radar} />
          <CredentialScene />
          <div className={s.caption}>
            <div>Bevaka dina fastigheter<br />adress för adress.</div>
            <p>Väder, varningar och driftavbrott i din portfölj.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
