import { C, card } from '@/lib/design/tokens';

/** Shown in live mode when the API cannot provide a portfolio. Never falls back to demo data. */
export function LiveUnavailable({ reason }: { reason: string }) {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: C.page, padding: 24, boxSizing: 'border-box' }}>
      <div style={{ ...card, padding: 28, maxWidth: 480 }}>
        <div style={{ fontSize: 13, color: C.text3 }}>FastighetsRadar · live-läge</div>
        <h1 style={{ margin: '8px 0 0', fontSize: 28, fontWeight: 500, letterSpacing: '-0.03em' }}>Portföljdata otillgängliga</h1>
        <p style={{ color: C.text3, fontSize: 14, lineHeight: 1.5 }}>{reason}</p>
        <p style={{ color: C.text4, fontSize: 12.5, lineHeight: 1.5 }}>
          Status är okänd – det betyder inte att läget är normalt. Försök igen om en stund eller kontakta supporten om felet kvarstår.
        </p>
      </div>
    </main>
  );
}
