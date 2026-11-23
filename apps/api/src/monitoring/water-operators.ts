type MunicipalWaterProvider = { id: string; name: string; publication: 'connected' | 'no_readable_source' };

// Municipal principals and public feed scope, verified in docs/plans/va-kartlaggning.md.
const CONNECTED = [
  ['svoa', 'Stockholm Vatten och Avfall', ['Stockholm', 'Huddinge']],
  ['tekniskaverken', 'Tekniska verken', ['Linköping']],
  ['servicealert:soderhamn', 'Söderhamn Nära', ['Söderhamn']],
  ['servicealert:oxelo', 'Oxelö Energi', ['Oxelösund']],
  ['servicealert:emmaboda', 'Emmaboda Energi', ['Emmaboda']],
  ['servicealert:eem', 'Eskilstuna Energi och Miljö', ['Eskilstuna']],
  ['servicealert:ljusdal', 'Ljusdal Vatten', ['Ljusdal']],
  ['servicealert:ulricehamn', 'Ulricehamns Energi', ['Ulricehamn']],
  ['servicealert:goteborg', 'Göteborgs Stad, Kretslopp och vatten', ['Göteborg']],
  ['nsva', 'Nordvästra Skånes Vatten och Avlopp', ['Helsingborg', 'Landskrona', 'Bjuv', 'Båstad', 'Perstorp', 'Svalöv', 'Åstorp', 'Örkelljunga']],
  ['servicealert:malarenergi-va', 'Mälarenergi Vatten', ['Västerås']],
  ['servicealert:gastrike-vatten', 'Gästrike Vatten', ['Gävle', 'Hofors', 'Ockelbo', 'Älvkarleby', 'Östhammar']],
  ['servicealert:msva', 'MittSverige Vatten & Avfall', ['Sundsvall', 'Timrå', 'Nordanstig']],
  ['servicealert:vaxjo-va', 'Växjö kommun', ['Växjö']],
  ['servicealert:lumire', 'Luleå Miljöresurs', ['Luleå']],
  ['servicealert:molndal-va', 'Mölndals stad', ['Mölndal']],
] as const;

const municipalityKey = (name: string) => name.normalize('NFC').trim().toLocaleLowerCase('sv');
const providers = new Map<string, MunicipalWaterProvider>();
for (const [id, name, municipalities] of CONNECTED) {
  for (const municipality of municipalities) providers.set(municipalityKey(municipality), { id, name, publication: 'connected' });
}
providers.set('norrköping', { id: 'va:nodra', name: 'Nodra', publication: 'no_readable_source' });
providers.set('upplands väsby', { id: 'va:upplands-vasby', name: 'Upplands Väsby kommun', publication: 'no_readable_source' });

export function municipalWaterProvider(municipality: string | null | undefined): MunicipalWaterProvider | undefined {
  if (!municipality) return undefined;
  const key = municipalityKey(municipality);
  const withoutSuffix = key.replace(/\s+(?:kommun|stad)$/, '');
  return providers.get(withoutSuffix) ?? (withoutSuffix.endsWith('s') ? providers.get(withoutSuffix.slice(0, -1)) : undefined);
}
