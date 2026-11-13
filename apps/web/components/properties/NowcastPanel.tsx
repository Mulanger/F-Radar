import type { DetailVM } from '@/lib/view-models/detail';
import { C, card, cardTitle, SEV } from '@/lib/design/tokens';
export function NowcastPanel({d}:{d:DetailVM}) {
  const n=d.nowcast;
  return <section style={{...card,padding:22,minWidth:0}}>
    <div style={cardTitle}>Nederbörd närmaste 2 h</div>
    <p style={{fontSize:14,lineHeight:1.6,color:n.tone==='warning'?SEV.warning.c:C.ink}}>{n.text}</p>
    <div role="img" aria-label="Radarprognos i femminuterssteg" style={{display:'flex',alignItems:'flex-end',gap:3,height:52}}>
      {n.bars.map((b,i)=><div key={i} title={`${b.at} · ${b.label}`} style={{flex:1,minWidth:0,height:b.height==null?'100%':`${b.height}%`,background:b.height==null?'repeating-linear-gradient(135deg,#EEF0F1,#EEF0F1 3px,#FAFBFC 3px,#FAFBFC 6px)':'#4A86C5',borderRadius:2}} />)}
    </div>
    <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:C.text3,marginTop:6}}><span>Nu</span><span>+1 h</span><span>+2 h</span></div>
    <p style={{fontSize:11,lineHeight:1.7,color:C.text3,marginBottom:0}}>{n.source}<br/>{n.attribution} · <a href={n.licenseUrl} style={{color:'inherit'}}>CC BY 4.0</a></p>
  </section>;
}
