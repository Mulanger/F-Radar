import Link from 'next/link';

const CC_BY = 'https://creativecommons.org/licenses/by/4.0/deed.sv';

/** Dokument E – Datakällor, licenser och metodbeskrivning. */
export function DataSourcesDocument() {
  return (
    <>
      <p>
        FastighetsRadar kopplar ihop öppna svenska och nordiska myndighetsdata med era sparade adresser. Vi märker varje värde i gränssnittet
        med sin dataklass: <strong>Observation</strong>, <strong>Modell</strong>, <strong>Statiskt scenario</strong>, <strong>Regional statistik</strong> eller <strong>Ej bedömd</strong>.
      </p>

      <h2 id="kallor">Datakällor och licenser</h2>
      <ul>
        <li><strong>SMHI</strong> (punktprognoser, vädervarningar, MetObs, havsvattenstånd) – öppna data från Sveriges meteorologiska och hydrologiska institut, publicerade under <a href={CC_BY} target="_blank" rel="noopener noreferrer">Creative Commons Erkännande 4.0 Internationell (CC BY 4.0)</a>.</li>
        <li><strong>MET Norway</strong> (nederbördsradar 2 h) – data från Meteorologisk institutt, bearbetad av FastighetsRadar under CC BY 4.0.</li>
        <li><strong>Krisinformation.se / MSB</strong> (VMA och samhällsinformation) – offentlig krisinformation per kommun och län.</li>
        <li><strong>Trafikverket</strong> (trafikhändelser och framkomlighet) – öppna trafikdata matchade inom kundens valda avstånd (100 m–3 km).</li>
        <li><strong>SGU</strong> (grundvattennivåer – HYPE-modell och mätstationer) – Sveriges geologiska undersökning.</li>
        <li><strong>MCF / MSB</strong> (översvämningskartering) – statiska karterade översvämningsscenarier (t.ex. 100-årsflöde).</li>
        <li><strong>Naturvårdsverket / SMHI</strong> (luftkvalitet – PM2,5 och NO₂) – preliminära timhalter från närmaste tillgängliga mätstation.</li>
        <li><strong>SCB</strong> (regional statistik) – Statistiska centralbyrån, kommunnivå.</li>
        <li><strong>Nät- och energibolag</strong> (avbrott i el samt vatten och avlopp) – driftstörningar som bolagen själva publicerar för sina områden.</li>
        <li><strong>Kartor och adressökning:</strong> kartdata © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap-bidragsgivare</a>; kartrutor och geokodning drivs av <strong>Geoapify</strong> och <strong>OpenMapTiles</strong>. Adresspunkter är inte juridiska fastighetsgränser.</li>
      </ul>

      <h2 id="riskindex">Om Samlad fastighetsrisk (Riskindex v1)</h2>
      <p>
        <strong>Riskindex</strong> (0–100) är FastighetsRadars egen sammanvägning av väder, vatten, VMA, framkomlighet och utomhusluft – samt el
        där avbrottsinformation finns – för att hjälpa förvaltare att snabbt prioritera vilka fastigheter som kräver uppmärksamhet
        först. Riskindex är <strong>inte</strong> en officiell myndighetsbedömning eller försäkringsklassning. Officiella vädervarningar från
        SMHI och VMA från Krisinformation visas alltid oförändrade bredvid indexet.
      </p>
      <p>
        Tjänsten är ett informations- och beslutsstöd, inte ett säkerhetsklassat larmsystem – se <Link href="/villkor#ansvarsfriskrivning">Användarvillkoren, avsnitt 3</Link>.
      </p>
    </>
  );
}
