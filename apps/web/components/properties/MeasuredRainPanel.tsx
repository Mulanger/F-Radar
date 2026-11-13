import type { DetailVM } from '@/lib/view-models/detail';
import { C,card,cardTitle } from '@/lib/design/tokens';
export function MeasuredRainPanel({d}:{d:DetailVM}) {
  return <section style={{...card,padding:22,minWidth:0}}>
    <div style={cardTitle}>Uppmätt nederbörd</div>
    {d.measuredRain?<>
      <p style={{fontSize:13,lineHeight:1.8}}>{d.measuredRain.station}</p>
      <div style={{display:'flex',gap:24,flexWrap:'wrap'}}>{d.measuredRain.totals.map(t=><div key={t.hours} style={{fontSize:13,lineHeight:1.8}}>
        <div style={{color:C.text3}}>{t.label}</div><div>{t.value}</div><div style={{fontSize:11,color:C.text3}}>{t.coverage}</div>
      </div>)}</div>
      <p style={{fontSize:11,color:C.text3,lineHeight:1.7,marginBottom:0}}>{d.measuredRain.source}<br/>{d.measuredRain.note}</p>
    </>:<p style={{fontSize:13,color:C.text3}}>SMHI · mätserie ej tillgänglig vid närliggande station</p>}
  </section>;
}
