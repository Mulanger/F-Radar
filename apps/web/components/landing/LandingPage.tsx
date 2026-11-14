import Link from 'next/link';
import {
  DATA_CLASSES,
  DATA_SOURCES,
  NAV_LINKS,
  NEARBY_EVENTS,
  OFFICIAL_WARNINGS,
  PORTFOLIO_ROWS,
  RAIN_BARS,
  SEVERITY_ORDER,
} from '@/lib/landing/content';
import { LandingHero } from './LandingHero';
import { ForecastPanel, GetStartedForm, SmsRuleDemo, WaterCanvas } from './LandingInteractive';
import { Badge, Bullets, LogoMark, StatusPill } from './Primitives';
import { Reveal } from './Reveal';
import {
  card, cardHead, cardSub, cardTitle, container, eyebrow, featureRow, h2, lead, MONO, smallCard, sourceChip, textBlock, visualBlock,
} from './styles';
import css from './landing.module.css';

/**
 * Public landing page (`/`) – ported from the approved design "FastighetsRadar Landningssida".
 * Server component: all copy is in the HTML; interactive parts are small client islands.
 */
export function LandingPage({ signedIn }: { signedIn: boolean }) {
  return (
    <div className={css.root}>
      <a href="#innehall" className="fr-sr-only">Hoppa till innehållet</a>
      <LandingHeader signedIn={signedIn} />
      <main id="innehall">
        <LandingHero signedIn={signedIn} />
        <HowItWorks />
        <section id="funktioner" aria-labelledby="funktioner-rubrik" style={{ scrollMarginTop: 90, padding: 'clamp(100px,12vw,170px) 0 0' }}>
          <h2 id="funktioner-rubrik" className="fr-sr-only">Funktioner</h2>
          <div style={{ ...container, display: 'flex', flexDirection: 'column', gap: 'clamp(100px,12vw,160px)' }}>
            <PortfolioFeature />
            <WarningsFeature />
            <WaterFeature />
            <InstrumentsFeature />
            <SmsFeature />
          </div>
        </section>
        <DataSection />
        <GetStarted signedIn={signedIn} />
      </main>
      <LandingFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LandingHeader({ signedIn }: { signedIn: boolean }) {
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
        <a href="#top" className={css.navBrand} aria-label="FastighetsRadar – till toppen" style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
          <LogoMark />
          <span style={{ fontWeight: 600, fontSize: 17, letterSpacing: '-0.02em' }}>FastighetsRadar</span>
        </a>
        {/* Links that do not fit wrap onto a hidden second row (design behaviour on narrow screens). */}
        <div className={css.navLinks} style={{ flex: '1 1 auto', minWidth: 0, height: 36, overflow: 'hidden', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 2 }}>
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className={css.navLink} style={{ height: 36, display: 'flex', alignItems: 'center', padding: '0 14px', borderRadius: 999, fontSize: 14.5 }}>
              {l.label}
            </a>
          ))}
        </div>
        <Link href="/overview" className={`${css.primary} ${css.mobileNavCta}`}>Öppna översikten</Link>
        <div className={css.desktopOnly} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
          {signedIn ? (
            <Link href="/overview" className={css.primary} style={{ height: 40, display: 'flex', alignItems: 'center', padding: '0 18px', borderRadius: 999, fontSize: 14.5, fontWeight: 500, background: '#14171A' }}>
              Öppna översikten
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className={`${css.ghost} ${css.navCtaSecondary}`} style={{ height: 40, display: 'flex', alignItems: 'center', padding: '0 16px', borderRadius: 999, fontSize: 14.5, fontWeight: 500 }}>
                Logga in
              </Link>
              <Link href="/sign-up" className={css.primary} style={{ height: 40, display: 'flex', alignItems: 'center', padding: '0 18px', borderRadius: 999, fontSize: 14.5, fontWeight: 500, background: '#14171A' }}>
                Kom igång
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

/* ------------------------------------------------------------------ */

const stepCard = { ...card, boxShadow: '0 1px 2px rgba(20,23,26,0.04),0 18px 40px -28px rgba(20,23,26,0.2)', padding: 14, display: 'flex', flexDirection: 'column' as const, gap: 22 };
const stepText = { padding: '0 12px 14px', display: 'flex', flexDirection: 'column' as const, gap: 10 };
const stepNo = { fontFamily: MONO, fontSize: 12.5, color: '#6B737B' };
const stepH3 = { margin: 0, fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em' };
const stepP = { margin: 0, fontSize: 15.5, lineHeight: 1.55, color: '#4A5157', textWrap: 'pretty' as const };

function HowItWorks() {
  return (
    <section id="sa-fungerar-det" aria-labelledby="steg-rubrik" style={{ scrollMarginTop: 90, padding: 'clamp(80px,10vw,140px) 0 0' }}>
      <div style={{ ...container, display: 'flex', flexDirection: 'column', gap: 48 }}>
        <Reveal style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 }}>
          <span style={eyebrow}>Så fungerar det</span>
          <h2 id="steg-rubrik" style={h2}>Från adress till besked i tre steg.</h2>
          <p style={{ ...lead, maxWidth: '34em' }}>Ingen hårdvara, inga sensorer att installera. FastighetsRadar kopplar ihop det myndigheterna redan publicerar med just dina adresser.</p>
        </Reveal>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 20 }}>
          <li>
            <Reveal style={{ ...stepCard, height: '100%', boxSizing: 'border-box' }}>
              <div aria-hidden="true" style={{ height: 200, borderRadius: 18, background: '#F7F8F6', position: 'relative', overflow: 'hidden', padding: 22, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 16px', borderRadius: 999, background: '#FFFFFF', border: '1px solid rgba(20,23,26,0.08)', fontSize: 14.5 }}>
                  <span style={{ width: 11, height: 11, borderRadius: '50%', border: '1.6px solid #9AA1A8', boxSizing: 'border-box', flex: 'none' }} />
                  Augustendalsvägen 20
                  <span style={{ width: 1, height: 18, background: '#14171A', marginLeft: -6 }} />
                </div>
                <div style={{ borderRadius: 16, background: '#FFFFFF', border: '1px solid rgba(20,23,26,0.06)', padding: 6, display: 'flex', flexDirection: 'column', gap: 2, boxShadow: '0 10px 24px -16px rgba(20,23,26,0.25)' }}>
                  <div style={{ padding: '9px 12px', borderRadius: 11, background: '#F1F3F2', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14 }}>Augustendalsvägen 20</span>
                    <span style={{ fontSize: 12.5, color: '#6B737B' }}>131 52 Nacka Strand</span>
                  </div>
                  <div style={{ padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14, color: '#4A5157' }}>Augustendalsvägen 22</span>
                    <span style={{ fontSize: 12.5, color: '#6B737B' }}>131 52 Nacka Strand</span>
                  </div>
                </div>
              </div>
              <div style={stepText}>
                <span style={stepNo}>01</span>
                <h3 style={stepH3}>Lägg till en adress</h3>
                <p style={stepP}>Sök en svensk adress, bekräfta positionen på kartan och spara. Lägg till en fastighet eller hela portföljen.</p>
              </div>
            </Reveal>
          </li>
          <li>
            <Reveal style={{ ...stepCard, height: '100%', boxSizing: 'border-box' }}>
              <div aria-hidden="true" style={{ height: 200, borderRadius: 18, background: '#EDF0F0', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: '50%', top: '50%', width: 250, height: 250, margin: '-125px 0 0 -125px', borderRadius: '50%', border: '1px dashed rgba(216,71,58,0.45)' }} />
                <div style={{ position: 'absolute', left: '50%', top: '50%', width: 150, height: 150, margin: '-75px 0 0 -75px', borderRadius: '50%', background: 'rgba(74,127,208,0.08)', border: '1px solid rgba(74,127,208,0.25)' }} />
                <div style={{ position: 'absolute', left: '50%', top: '50%', width: 18, height: 18, margin: '-9px 0 0 -9px', borderRadius: '50%', background: '#14171A', border: '3px solid #FFFFFF', boxSizing: 'border-box', boxShadow: '0 4px 10px rgba(20,23,26,0.3)' }} />
                <span style={{ ...sourceChip, fontSize: 12, padding: '4px 8px', borderRadius: 8, background: '#FFFFFF', position: 'absolute', left: 14, top: 18 }}>SMHI</span>
                <span style={{ ...sourceChip, fontSize: 12, padding: '4px 8px', borderRadius: 8, background: '#FFFFFF', position: 'absolute', right: 16, top: 40 }}>Krisinformation</span>
                <span style={{ ...sourceChip, fontSize: 12, padding: '4px 8px', borderRadius: 8, background: '#FFFFFF', position: 'absolute', left: 22, bottom: 30 }}>Trafikverket</span>
                <span style={{ ...sourceChip, fontSize: 12, padding: '4px 8px', borderRadius: 8, background: '#FFFFFF', position: 'absolute', right: 26, bottom: 18 }}>SGU</span>
                <span style={{ position: 'absolute', left: '50%', top: '50%', margin: '16px 0 0 -38px', fontFamily: MONO, fontSize: 11, color: '#4A5157' }}>radie 1 km</span>
              </div>
              <div style={stepText}>
                <span style={stepNo}>02</span>
                <h3 style={stepH3}>Vi bevakar positionen</h3>
                <p style={stepP}>Varningar, händelser och mätningar matchas mot fastighetens exakta läge — inte bara mot kommunen den ligger i.</p>
              </div>
            </Reveal>
          </li>
          <li>
            <Reveal style={{ ...stepCard, height: '100%', boxSizing: 'border-box' }}>
              <div aria-hidden="true" style={{ height: 200, borderRadius: 18, background: '#F7F8F6', position: 'relative', overflow: 'hidden', padding: 22, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
                <span style={{ alignSelf: 'center', fontFamily: MONO, fontSize: 11.5, color: '#6B737B' }}>Ons 12 nov · 14:32</span>
                <div style={{ maxWidth: '88%', padding: '12px 15px', borderRadius: '18px 18px 18px 6px', background: '#E8EBEA', fontSize: 14, lineHeight: 1.45 }}>
                  Orange varning: kraftig vind vid Augustendal Brygga. Byar upp till 25 m/s. Källa: SMHI
                </div>
                <span style={{ fontSize: 12.5, color: '#6B737B', paddingLeft: 4 }}>FastighetsRadar</span>
              </div>
              <div style={stepText}>
                <span style={stepNo}>03</span>
                <h3 style={stepH3}>Du får besked</h3>
                <p style={stepP}>Se läget i portföljöversikten och få SMS enligt dina egna regler — bara när det är relevant.</p>
              </div>
            </Reveal>
          </li>
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function PortfolioFeature() {
  const grid = { display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr) 44px minmax(0,1.2fr)', alignItems: 'center', gap: 10, padding: '11px 0', borderTop: '1px solid rgba(20,23,26,0.06)' };
  return (
    <div style={featureRow()}>
      <Reveal style={textBlock}>
        <span style={eyebrow}>Portföljöversikt</span>
        <h2 style={h2}>Hela portföljen. En blick.</h2>
        <p style={lead}>Status för varje fastighet, sorterad efter vad som behöver uppmärksamhet först. Karta, händelseflöde och officiella varningar i samma vy.</p>
        <Bullets items={['Fyra tydliga lägen — från ingen aktiv varning till kritisk', 'Händelser från alla källor i ett gemensamt flöde', 'Filtrera per område, till exempel innerstad eller kust']} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 10 }}>
          {SEVERITY_ORDER.map((k) => (
            <StatusPill key={k} severity={k} />
          ))}
        </div>
      </Reveal>
      <Reveal style={{ ...visualBlock, position: 'relative' }}>
        <div style={{ position: 'relative', borderRadius: 26, overflow: 'hidden', aspectRatio: '1055/470', background: '#EDF0F0', border: '1px solid rgba(20,23,26,0.06)', boxShadow: '0 18px 40px -28px rgba(20,23,26,0.25)' }}>
          <img src="/landing/portfolio-map.webp" alt="Portföljkarta med åtta fastigheter i Stockholmsregionen" width={1055} height={470} loading="lazy" decoding="async" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', left: 14, top: 14, padding: '10px 16px', borderRadius: 16, background: 'rgba(255,255,255,0.86)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 500 }}>Portföljkarta</span>
            <span style={{ fontSize: 12.5, color: '#4A5157' }}>8 fastigheter · Stockholmsregionen</span>
          </div>
          <span style={{ position: 'absolute', right: 10, bottom: 6, fontSize: 10, color: '#4A5157', background: 'rgba(255,255,255,0.7)', padding: '2px 6px', borderRadius: 4 }}>© OpenStreetMap-bidragsgivare</span>
        </div>
        <div style={{ position: 'relative', margin: '-56px 0 0 auto', width: '92%', ...card, borderRadius: 22, boxShadow: '0 1px 2px rgba(20,23,26,0.04),0 24px 50px -28px rgba(20,23,26,0.3)', padding: '18px 20px 8px', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, paddingBottom: 10 }}>
            <span style={{ fontSize: 15.5, fontWeight: 500 }}>Bevakningsstatus</span>
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: '#6B737B' }}>Uppdaterad 14:32</span>
          </div>
          {PORTFOLIO_ROWS.map((r) => (
            <div key={r.name} style={grid}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                <span style={{ fontSize: 12, color: '#6B737B' }}>{r.area}</span>
              </div>
              <StatusPill severity={r.severity} size="sm" label={r.severity === 'normal' ? 'Ingen aktiv' : undefined} />
              <span style={{ fontSize: 15 }}>{r.temp}</span>
              <Badge label={r.warning.label} bg={r.warning.bg} fg={r.warning.fg} style={{ justifySelf: 'start', padding: '4px 8px', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  );
}

function WarningsFeature() {
  return (
    <div style={featureRow(true)}>
      <Reveal style={visualBlock}>
        <div style={{ ...card, padding: 'clamp(20px,3vw,30px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={cardHead}>
              <span style={cardTitle}>Officiella varningar</span>
              <span style={cardSub}>SMHI · Krisinformation</span>
            </div>
            <span style={{ fontFamily: MONO, fontSize: 13, color: '#4A5157', paddingTop: 4 }}>2 aktiva</span>
          </div>
          {OFFICIAL_WARNINGS.map((w) => (
            <article key={w.type} style={{ borderRadius: 18, border: '1px solid rgba(20,23,26,0.07)', background: '#FBFBFA', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Badge label={w.level} bg={w.bg} fg={w.fg} style={{ fontSize: 13.5, padding: '4px 10px', borderRadius: 8 }} />
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 500 }}>{w.type}</h3>
              </div>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: '#4A5157', textWrap: 'pretty' }}>{w.text}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 14, color: '#6B737B' }}>
                <span>Från <span style={{ color: '#14171A' }}>{w.from}</span></span>
                <span>Till <span style={{ color: '#14171A' }}>{w.to}</span></span>
                <span>SMHI</span>
                <span>{w.area}</span>
              </div>
            </article>
          ))}
        </div>
      </Reveal>
      <Reveal style={textBlock}>
        <span style={eyebrow}>Officiella varningar</span>
        <h2 style={h2}>Exakt som de utfärdats.</h2>
        <p style={lead}>Vi visar SMHI:s vädervarningar och VMA från Krisinformation oförändrade — med officiella färger, giltighetstid och berört område. Ingen egen tolkning, ingen dramatik.</p>
        <Bullets items={['Gul, orange och röd varning samt VMA', 'Geografiskt matchade mot varje fastighet', 'Uppdateringar och avslut syns direkt']} />
      </Reveal>
    </div>
  );
}

function WaterFeature() {
  const tile = { borderRadius: 14, background: '#F7F8F6', padding: '13px 16px', display: 'flex', flexDirection: 'column' as const, gap: 3 };
  return (
    <div style={featureRow()}>
      <Reveal style={textBlock}>
        <span style={eyebrow}>Vatten och översvämning</span>
        <h2 style={h2}>Från kajkanten till källaren.</h2>
        <p style={lead}>Vattennivå, karterade översvämningszoner från MCF och grundvatten från SGU — samlat per fastighet, med trend och avstånd till gränsvärdet.</p>
        <Bullets items={['Aktuell nivå mot översvämningsgräns', 'Avstånd till karterad översvämningszon', 'Grundvattennivå jämfört med det normala']} />
      </Reveal>
      <Reveal style={visualBlock}>
        <div style={{ ...card, padding: 'clamp(20px,3vw,30px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={cardHead}>
              <span style={cardTitle}>Vattenrisk</span>
              <span style={cardSub}>Översvämningsexponering och vattennivå</span>
            </div>
            <span style={{ fontSize: 13.5, fontWeight: 500, padding: '5px 11px', borderRadius: 999, background: '#FCE4E1', color: '#B8362B', whiteSpace: 'nowrap' }}>Exponering: Hög</span>
          </div>
          <div style={{ position: 'relative', height: 240, borderRadius: 20, overflow: 'hidden', background: 'linear-gradient(180deg,#F6F8F8,#EDF2F3)' }}>
            <WaterCanvas />
            <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: '27%', borderTop: '1.5px dashed #D8473A', opacity: 0.8 }} />
            <span style={{ position: 'absolute', right: 14, top: 'calc(27% - 28px)', fontSize: 12.5, color: '#B8362B', background: 'rgba(255,255,255,0.9)', padding: '3px 8px', borderRadius: 7 }}>Översvämningsgräns +60 cm</span>
            <div style={{ position: 'absolute', left: 16, top: 16, padding: '10px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.9)', display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 12.5, color: '#6B737B' }}>Saltsjön</span>
              <span style={{ fontSize: 26, letterSpacing: '-0.02em' }}>+41 cm</span>
            </div>
          </div>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 10 }}>
            {([['Karterad översvämningszon', '15 m · inom buffert'], ['Trend', 'Stigande +4 cm/h'], ['Grundvatten · SGU', 'Över det normala'], ['Källarrisk', 'Förhöjd']] as const).map(([l, v]) => (
              <div key={l} style={tile}>
                <dt style={{ fontSize: 13, color: '#6B737B' }}>{l}</dt>
                <dd style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Reveal>
    </div>
  );
}

function InstrumentsFeature() {
  const big = { fontSize: 44, letterSpacing: '-0.04em', lineHeight: 1 };
  const unit = { fontSize: 18, color: '#6B737B', letterSpacing: 0, marginLeft: 4 };
  const foot = { fontSize: 13, color: '#6B737B', marginTop: 'auto' };
  const label = { fontSize: 14, color: '#4A5157' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      <Reveal style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 }}>
        <span style={eyebrow}>Väder, luft och omgivning</span>
        <h2 style={h2}>En instrumentpanel för varje adress.</h2>
        <p style={{ ...lead, maxWidth: '34em' }}>Punktprognos från SMHI, luftkvalitet från närmaste mätstation och störningar inom larmradien — uppdaterat löpande.</p>
      </Reveal>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
        <Reveal style={smallCard}>
          <span style={label}>Temperatur nu</span>
          <span style={big}>3,9°</span>
          <svg aria-hidden="true" viewBox="0 0 200 40" preserveAspectRatio="none" style={{ width: '100%', height: 36, display: 'block' }}>
            <path d="M0,10 C20,10 30,14 50,20 C70,26 80,22 100,30 C115,36 130,30 150,24 C170,18 180,6 200,8" fill="none" stroke="#E08A2E" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <span style={foot}>Känns som −1,4° · 0,7° till 6° kommande 24 h</span>
        </Reveal>
        <Reveal style={smallCard}>
          <span style={label}>Nederbörd prognos 24 h</span>
          <span style={big}>22,1<span style={unit}>mm</span></span>
          <div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 36 }}>
            {RAIN_BARS.map(([h, c], i) => (
              <span key={i} style={{ flex: 1, height: `${h}%`, borderRadius: 2, background: c }} />
            ))}
          </div>
          <span style={foot}>Max 3,1 mm/h kl. 02:00</span>
        </Reveal>
        <Reveal style={smallCard}>
          <span style={label}>Vindhastighet</span>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={big}>14,2<span style={unit}>m/s</span></span>
            <div aria-label="Vind från söder" role="img" style={{ position: 'relative', width: 56, height: 56, borderRadius: '50%', border: '1px solid rgba(20,23,26,0.12)', flex: 'none' }}>
              <span style={{ position: 'absolute', left: '50%', top: 3, transform: 'translateX(-50%)', fontFamily: MONO, fontSize: 8, color: '#6B737B' }}>N</span>
              <span style={{ position: 'absolute', left: '50%', top: '50%', width: 2, height: 30, margin: '-15px 0 0 -1px', background: '#14171A', borderRadius: 2, transform: 'rotate(18deg)' }} />
              <span style={{ position: 'absolute', left: '50%', top: '50%', width: 6, height: 6, margin: '-3px 0 0 -3px', background: '#14171A', borderRadius: '50%' }} />
            </div>
          </div>
          <div aria-hidden="true" style={{ height: 6, borderRadius: 999, background: '#F1F3F2', overflow: 'hidden', marginTop: 6 }}>
            <div style={{ width: '57%', height: '100%', borderRadius: 999, background: '#3C8C9A' }} />
          </div>
          <span style={foot}>Byar 25 m/s · från S</span>
        </Reveal>
        <Reveal style={smallCard}>
          <span style={label}>Luftkvalitet</span>
          <span style={big}>26<span style={{ ...unit, color: '#2B7D4D', marginLeft: 6 }}>Bra</span></span>
          <div aria-hidden="true" style={{ position: 'relative', height: 6, borderRadius: 999, background: 'linear-gradient(90deg,#3FA66B,#D9C43A,#E08A2E,#D8473A)', marginTop: 16 }}>
            <span style={{ position: 'absolute', left: '18%', top: -5, width: 4, height: 16, borderRadius: 2, background: '#14171A' }} />
          </div>
          <span style={foot}>PM2,5 6 µg/m³ · NO₂ 16 µg/m³</span>
        </Reveal>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,440px),1fr))', gap: 16 }}>
        <Reveal>
          <ForecastPanel />
        </Reveal>
        <Reveal style={{ ...card, boxShadow: '0 1px 2px rgba(20,23,26,0.04)', padding: 'clamp(20px,3vw,28px)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingBottom: 10 }}>
            <div style={cardHead}>
              <span style={cardTitle}>Händelser i närheten</span>
              <span style={cardSub}>Inom larmradien 1 km</span>
            </div>
            <span style={{ fontFamily: MONO, fontSize: 13, color: '#4A5157', paddingTop: 4 }}>4 st</span>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {NEARBY_EVENTS.map((ev, i) => (
              <li key={ev.title} style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) auto', gap: '4px 14px', alignItems: 'start', padding: i === NEARBY_EVENTS.length - 1 ? '14px 0 0' : '14px 0', borderTop: '1px solid rgba(20,23,26,0.06)' }}>
                <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 12, background: ev.bg, display: 'grid', placeItems: 'center' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: ev.dot }} />
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                  <span style={{ fontSize: 15, lineHeight: 1.4 }}>{ev.title}</span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={sourceChip}>{ev.source}</span>
                    <span style={{ fontSize: 13, color: '#6B737B' }}>{ev.where}</span>
                  </span>
                </div>
                <span style={{ fontFamily: MONO, fontSize: 12, color: '#6B737B' }}>{ev.time}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </div>
  );
}

function SmsFeature() {
  return (
    <div id="sms" style={{ ...featureRow(true), scrollMarginTop: 90 }}>
      <Reveal style={visualBlock}>
        <SmsRuleDemo />
      </Reveal>
      <Reveal style={textBlock}>
        <span style={eyebrow}>SMS-larm</span>
        <h2 style={h2}>SMS när det spelar roll. Tyst när det inte gör det.</h2>
        <p style={lead}>Bestäm själv vilka nivåer, fastigheter och mottagare som gäller. Tysta timmar och dagliga gränser gör att ett SMS från oss alltid betyder något. Prova reglerna här bredvid.</p>
        <Bullets items={['Egna regler per fastighet och varningsnivå', 'Tysta timmar och max antal per dag', 'Logg över varje utskick']} />
      </Reveal>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DataSection() {
  return (
    <section id="data" aria-labelledby="data-rubrik" style={{ scrollMarginTop: 90, padding: 'clamp(100px,12vw,170px) 0 0' }}>
      <div style={container}>
        <Reveal style={{ ...card, borderRadius: 32, boxShadow: '0 1px 2px rgba(20,23,26,0.04),0 30px 60px -40px rgba(20,23,26,0.25)', padding: 'clamp(28px,5vw,64px)', display: 'flex', flexWrap: 'wrap', gap: 'clamp(32px,5vw,72px)' }}>
          <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 480 }}>
            <span style={eyebrow}>Transparens</span>
            <h2 id="data-rubrik" style={{ ...h2, fontSize: 'clamp(32px,3.6vw,48px)', lineHeight: 1.04 }}>Du ser alltid vad en siffra är.</h2>
            <p style={{ ...lead, fontSize: 17 }}>Varje värde märks med sin dataklass, så att du vet om det är uppmätt, beräknat eller statistik. Saknas underlag står det ”Ej bedömd” — vi gissar inte.</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 16, background: '#F7F8F6', alignSelf: 'flex-start', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px', borderRadius: 999, background: '#EEF0EF', color: '#6B737B', fontSize: 13, fontWeight: 500 }}>
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: '#9AA1A8' }} />
                Ej bedömd
              </span>
              <span style={{ fontSize: 14, color: '#4A5157' }}>Visas när underlag saknas</span>
            </div>
          </div>
          <dl style={{ flex: '1.4 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', margin: 0 }}>
            {DATA_CLASSES.map((d, i) => (
              <div key={d.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,auto) minmax(0,1fr)', gap: '6px 24px', alignItems: 'baseline', padding: '20px 0', borderBottom: i < DATA_CLASSES.length - 1 ? '1px solid rgba(20,23,26,0.07)' : undefined }}>
                <dt style={{ justifySelf: 'start', fontFamily: MONO, fontSize: 12.5, padding: '5px 10px', borderRadius: 999, background: d.bg, color: d.fg }}>{d.label}</dt>
                <dd style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 16, fontWeight: 500 }}>{d.title}</span>
                  <span style={{ fontSize: 14, color: '#6B737B' }}>{d.example}</span>
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
        <Reveal style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, paddingTop: 56 }}>
          <span style={eyebrow}>Datakällor</span>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, maxWidth: 900 }}>
            {DATA_SOURCES.map((s) => (
              <li key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: MONO, fontSize: 13, padding: '8px 13px', borderRadius: 999, background: '#FFFFFF', border: '1px solid rgba(20,23,26,0.06)', color: '#4A5157' }}>
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: '#3FA66B' }} />
                {s}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

function GetStarted({ signedIn }: { signedIn: boolean }) {
  return (
    <section id="kom-igang" aria-labelledby="kom-igang-rubrik" style={{ scrollMarginTop: 90, padding: 'clamp(100px,12vw,170px) clamp(12px,2vw,24px) 0' }}>
      <Reveal style={{ maxWidth: 1320, margin: '0 auto', borderRadius: 32, background: 'linear-gradient(180deg,#E6EEF1 0%,#EEF2F2 100%)', border: '1px solid rgba(255,255,255,0.9)', padding: 'clamp(56px,8vw,110px) clamp(24px,4vw,48px)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 22 }}>
        <span style={{ borderRadius: 16, boxShadow: '0 14px 30px -14px rgba(20,23,26,0.5)', display: 'inline-flex' }}>
          <LogoMark size={52} radius={16} />
        </span>
        <h2 id="kom-igang-rubrik" style={{ margin: 0, fontWeight: 500, fontSize: 'clamp(36px,4.8vw,64px)', lineHeight: 1, letterSpacing: '-0.045em', textWrap: 'balance', maxWidth: '14em' }}>
          Börja bevaka din första fastighet.
        </h2>
        <p style={{ ...lead, maxWidth: '30em' }}>{signedIn ? 'Du är inloggad – fortsätt till din portfölj.' : 'Skapa ett konto, lägg till en adress och se läget direkt.'}</p>
        <GetStartedForm signedIn={signedIn} />
        {!signedIn && (
          <span style={{ fontSize: 14.5, color: '#6B737B' }}>
            Har du redan ett konto? <Link href="/sign-in" style={{ fontWeight: 500 }}>Logga in</Link>
          </span>
        )}
      </Reveal>
    </section>
  );
}

function LandingFooter() {
  const col = { display: 'flex', flexDirection: 'column' as const, gap: 12, fontSize: 14.5 };
  return (
    <footer style={{ padding: '72px 0 40px' }}>
      <div style={{ ...container, display: 'flex', flexDirection: 'column', gap: 48 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 40 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 320 }}>
            <a href="#top" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <LogoMark size={30} radius={9} />
              <span style={{ fontWeight: 600, fontSize: 16, letterSpacing: '-0.02em' }}>FastighetsRadar</span>
            </a>
            <span style={{ fontSize: 14.5, lineHeight: 1.55, color: '#6B737B' }}>Miljö- och samhällsbevakning för fastigheter, byggd på svensk offentlig data.</span>
          </div>
          <nav aria-label="Sidfot" style={{ display: 'flex', flexWrap: 'wrap', gap: 56 }}>
            <div style={col}>
              <span style={eyebrow}>Produkt</span>
              <a href="#funktioner" className={css.footerLink}>Funktioner</a>
              <a href="#sms" className={css.footerLink}>SMS-larm</a>
              <a href="#data" className={css.footerLink}>Datakällor</a>
            </div>
            <div style={col}>
              <span style={eyebrow}>Konto</span>
              <Link href="/sign-up" className={css.footerLink}>Skapa konto</Link>
              <Link href="/sign-in" className={css.footerLink}>Logga in</Link>
            </div>
          </nav>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, paddingTop: 22, borderTop: '1px solid rgba(20,23,26,0.08)', fontSize: 13, color: '#6B737B' }}>
          <span>© {new Date().getFullYear()} FastighetsRadar</span>
          <span>Data: SMHI, Krisinformation, Trafikverket, SGU, MCF, SCB · Kartdata © OpenStreetMap-bidragsgivare</span>
        </div>
      </div>
    </footer>
  );
}
