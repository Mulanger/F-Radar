import type { DetailVM } from '@/lib/view-models/detail';
import { C, card, cardSub, cardTitle } from '@/lib/design/tokens';

/** Five Swedish calendar days as compact tiles (two per row on phones, one row on desktop). */
export function ForecastDays({ d }: { d: DetailVM }) {
  return (
    <section style={{ ...card, padding: 22, minWidth: 0 }}>
      <div style={cardTitle}>Kommande dygn</div>
      <div style={cardSub}>{d.forecastSource} · nederbörd som medelvärde, osäkerhetsintervall inom parentes</div>
      {d.forecastDays.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 10, marginTop: 16 }}>
          {d.forecastDays.map((day) => (
            <div key={day.key} style={{ minWidth: 0, padding: '12px 14px', borderRadius: 14, background: 'rgba(20,23,26,0.035)', fontSize: 12, lineHeight: 1.55 }}>
              <div style={{ fontWeight: 500, color: C.text2 }}>{day.label}</div>
              <div style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.01em', margin: '2px 0' }}>{day.temperature}</div>
              <div>{day.rain}</div>
              {day.interval && <div style={{ color: C.text3, fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>({day.interval})</div>}
              <div style={{ color: C.text3 }}>{day.gust}</div>
              {day.snow && <div style={{ color: C.text3 }}>{day.snow}</div>}
            </div>
          ))}
        </div>
      ) : (
        <p style={{ color: C.text3, fontSize: 13 }}>Dygnsprognos ej tillgänglig</p>
      )}
    </section>
  );
}
