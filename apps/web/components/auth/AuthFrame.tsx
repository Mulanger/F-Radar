import { C } from '@/lib/design/tokens';

/**
 * Shared frame for sign-in, sign-up and onboarding: same page colour, brand mark and
 * typography as the dashboard, with a soft radial backdrop echoing the 3D hero cards.
 */
export function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        boxSizing: 'border-box',
        padding: '48px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 28,
        background: `radial-gradient(90% 70% at 50% 0%, #FFFFFF 0%, ${C.page} 60%, #E8EEF0 100%)`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 11, background: C.ink, display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 18, height: 18, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.9)', boxSizing: 'border-box', display: 'grid', placeItems: 'center' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'oklch(0.78 0.11 215)' }} />
          </div>
        </div>
        <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em' }}>FastighetsRadar</div>
      </div>
      <div style={{ textAlign: 'center', maxWidth: 460 }}>
        <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.1, fontWeight: 500, letterSpacing: '-0.035em' }}>{title}</h1>
        <p style={{ margin: '10px 0 0', color: C.text3, fontSize: 15, lineHeight: 1.5 }}>{subtitle}</p>
      </div>
      <div style={{ animation: 'frFade .45s ease both' }}>{children}</div>
    </main>
  );
}
