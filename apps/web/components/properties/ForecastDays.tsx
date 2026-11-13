import type { DetailVM } from '@/lib/view-models/detail';
import { C, card, cardSub, cardTitle } from '@/lib/design/tokens';

export function ForecastDays({ d }: { d: DetailVM }) {
  return <section style={{ ...card, padding: 22, minWidth: 0 }}>
    <div style={cardTitle}>Kommande dygn</div>
    <div style={cardSub}>{d.forecastSource} · fem rullande dygn · nederbördens medelvärde</div>
    {d.forecastDays.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 18, marginTop: 16 }}>
      {d.forecastDays.map(day => <div key={day.label} style={{ minWidth: 0, borderTop: '1px solid rgba(20,23,26,0.08)', paddingTop: 12, fontSize: 12, lineHeight: 1.8 }}>
        <div style={{ fontWeight: 500 }}>{day.label}</div><div>Temperatur {day.temperature}</div>
        <div>Nederbörd {day.rain}</div><div style={{ color: C.text3 }}>{day.interval}</div>
        <div>Högsta vindby {day.gust}</div><div>Andel snö {day.snow}</div>
      </div>)}
    </div> : <p style={{ color: C.text3, fontSize: 13 }}>Dygnsprognos ej tillgänglig</p>}
  </section>;
}
