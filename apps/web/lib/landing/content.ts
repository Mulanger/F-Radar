/**
 * Static content for the public landing page (`/`), ported from the approved design
 * "FastighetsRadar Landningssida.dc.html". All copy is Swedish. The values in the illustrations
 * (Augustendal Brygga etc.) are the same demo examples as the dashboard demo – they are marketing
 * illustrations, never live customer data.
 */

export type SeverityKey = 'normal' | 'monitor' | 'warning' | 'critical';

/** Landing-page status pills (same palette as the dashboard). */
export const SEVERITY: Record<SeverityKey, { label: string; bg: string; fg: string; dot: string }> = {
  normal: { label: 'Ingen aktiv varning', bg: '#E2F3E8', fg: '#2B7D4D', dot: '#3FA66B' },
  monitor: { label: 'Bevaka', bg: '#E3ECF9', fg: '#3463AE', dot: '#4A7FD0' },
  warning: { label: 'Varning', bg: '#FDEBD8', fg: '#A9530C', dot: '#E08A2E' },
  critical: { label: 'Kritisk', bg: '#FCE4E1', fg: '#B8362B', dot: '#D8473A' },
};
export const SEVERITY_ORDER: SeverityKey[] = ['normal', 'monitor', 'warning', 'critical'];

export const NAV_LINKS = [
  { href: '#sa-fungerar-det', label: 'Så fungerar det' },
  { href: '#funktioner', label: 'Funktioner' },
  { href: '#sms', label: 'SMS-larm' },
  { href: '#data', label: 'Datakällor' },
] as const;

export const HERO_SOURCES = ['SMHI', 'Krisinformation', 'Trafikverket', 'SGU', 'MCF', 'SCB'] as const;

export const HERO_STATS = [
  { label: 'Temperatur', value: '3,9°C' },
  { label: 'Vind', value: '14,2 m/s' },
  { label: 'Luftfuktighet', value: '90%' },
  { label: 'Nederbörd 24 h', value: '22,1 mm' },
] as const;

/** Badge colours for warning levels and data classes. */
export const BADGE = {
  orange: { bg: '#FCE1C6', fg: '#A9530C' },
  orangeSoft: { bg: '#FDEBD8', fg: '#A9530C' },
  yellow: { bg: '#FAF0BE', fg: '#7A5E00' },
  red: { bg: '#FCE1DD', fg: '#B8362B' },
  blue: { bg: '#E3ECF9', fg: '#3463AE' },
  green: { bg: '#E2F3E8', fg: '#2B7D4D' },
  grey: { bg: '#F1F3F2', fg: '#4A5157' },
} as const;

/**
 * Animated annotation cards in the hero. `anchor` is a point in the 3D scene (world units) the
 * card points at; `severity` drives the property status pill while the card is shown.
 */
export interface HeroAnnotation {
  source: string;
  time: string;
  badge: { label: string; bg: string; fg: string };
  title: string;
  detail: string;
  dot: string;
  severity: SeverityKey;
}
export const HERO_ANNOTATIONS: HeroAnnotation[] = [
  { source: 'SMHI', time: '14:32', badge: { label: 'Orange', ...BADGE.orange }, title: 'Kraftig vind', detail: 'Byar upp till 25 m/s längs kusten', dot: '#E08A2E', severity: 'warning' },
  { source: 'SMHI', time: '14:05', badge: { label: 'Varning', ...BADGE.orangeSoft }, title: 'Vattenstånd +41 cm', detail: 'Saltsjön · stigande +4 cm/h', dot: '#E08A2E', severity: 'warning' },
  { source: 'Krisinformation', time: '13:20', badge: { label: 'VMA', ...BADGE.red }, title: 'Industribrand', detail: 'Håll fönster och ventilation stängda', dot: '#D8473A', severity: 'critical' },
  { source: 'Trafikverket', time: '13:10', badge: { label: 'Bevaka', ...BADGE.blue }, title: 'Färjetrafik inställd', detail: 'Nacka Strand brygga · till 18:00', dot: '#4A7FD0', severity: 'monitor' },
  { source: 'SMHI', time: '12:50', badge: { label: 'Gul', ...BADGE.yellow }, title: 'Kraftigt regn', detail: '20–30 mm inom 12 timmar', dot: '#D9B21F', severity: 'monitor' },
  { source: 'Luftkvalitet', time: '14:00', badge: { label: 'Bra', ...BADGE.green }, title: 'Luftkvalitet 26', detail: 'PM2,5 6 µg/m³ · NO₂ 16 µg/m³', dot: '#3FA66B', severity: 'normal' },
];

export const HERO_SMS = 'Orange varning: kraftig vind vid Augustendal Brygga. Byar upp till 25 m/s, ons 16:00–tors 10:00. Källa: SMHI';

export const PORTFOLIO_ROWS = [
  { name: 'Augustendal Brygga', area: 'Nacka Strand', severity: 'critical' as const, temp: '3,9°', warning: { label: 'Orange · Kraftig vind', ...BADGE.orange } },
  { name: 'Sjöstaden Kaj', area: 'Hammarby Sjöstad', severity: 'warning' as const, temp: '4,2°', warning: { label: 'Gul · Kraftigt regn', ...BADGE.yellow } },
  { name: 'Strandhuset', area: 'Kungsholmen', severity: 'monitor' as const, temp: '4,6°', warning: { label: 'Gul · Kraftigt regn', ...BADGE.yellow } },
  { name: 'Odenplan Atrium', area: 'Vasastan', severity: 'normal' as const, temp: '4,0°', warning: { label: 'Ingen', bg: '#F1F3F2', fg: '#6B737B' } },
];

export const OFFICIAL_WARNINGS = [
  { level: 'Orange', ...BADGE.orange, type: 'Kraftig vind', text: 'Vindbyar på 21–25 m/s längs kusten. Risk för nedfallna träd, lösa föremål och störd färjetrafik.', from: 'ons 16:00', to: 'tors 10:00', area: 'Stockholms skärgård · Nacka' },
  { level: 'Gul', ...BADGE.yellow, type: 'Kraftigt regn', text: '20–30 mm inom 12 timmar i kustområden.', from: 'tors 06:00', to: 'tors 20:00', area: 'Nacka · Värmdö' },
];

export const NEARBY_EVENTS = [
  { title: 'VMA: industribrand, håll fönster och ventilation stängda', source: 'Krisinformation', where: '0,8 km', time: '13:20', ...pair('#FCE4E1', '#D8473A') },
  { title: 'Vattenståndet i Saltsjön +38 cm över medel och stigande', source: 'SMHI', where: 'Saltsjön', time: '14:05', ...pair('#FDEBD8', '#E08A2E') },
  { title: 'Färjetrafiken inställd vid Nacka Strand brygga', source: 'Trafikverket', where: '0,3 km', time: '13:10', ...pair('#E3ECF9', '#4A7FD0') },
  { title: 'Vägarbete på Värmdövägen, ett körfält avstängt', source: 'Trafikverket', where: '0,9 km', time: '12:42', ...pair('#E3ECF9', '#4A7FD0') },
];
function pair(bg: string, dot: string) {
  return { bg, dot };
}

export const DATA_CLASSES = [
  { label: 'Observation', ...BADGE.green, title: 'Uppmätt vid närmaste station', example: 'Temperatur 3,9 °C · SMHI MetObs, 2,1 km bort' },
  { label: 'Modell', ...BADGE.blue, title: 'Prognos eller beräkning', example: 'Nederbörd 22,1 mm kommande 24 h · SMHI' },
  { label: 'Statiskt scenario', ...BADGE.orangeSoft, title: 'Kartering av ett tänkt förlopp', example: 'Översvämning vid 100-årsflöde · MCF' },
  { label: 'Regional statistik', ...BADGE.grey, title: 'Gäller kommunen, inte adressen', example: 'Befolkning och bebyggelse, Nacka kommun · SCB' },
];

export const DATA_SOURCES = [
  'SMHI prognos',
  'SMHI vädervarningar',
  'SMHI MetObs',
  'Krisinformation',
  'Trafikverket',
  'Luftkvalitet',
  'SGU grundvatten',
  'MCF översvämningskartering',
  'SCB statistik',
] as const;

/** 24 h demo forecast series for the instrument chart (same values as the design). */
export const FORECAST = {
  t: { label: 'Temperatur', unit: '°', color: '#E08A2E', zero: false, vals: [5.6, 5.5, 5.2, 4.8, 4.5, 4.3, 4.1, 3.6, 3.0, 2.6, 2.7, 2.3, 2.0, 1.6, 0.8, 1.0, 1.5, 2.0, 2.6, 3.2, 3.9, 4.8, 5.6, 6.0] },
  r: { label: 'Nederbörd', unit: ' mm', color: '#4A7FD0', zero: true, vals: [0.2, 0.3, 0.5, 0.9, 1.4, 2.2, 2.8, 3.1, 2.6, 2.0, 1.6, 1.2, 0.9, 0.6, 0.4, 0.3, 0.2, 0.2, 0.1, 0.1, 0.2, 0.3, 0.2, 0.1] },
  w: { label: 'Vind', unit: ' m/s', color: '#3C8C9A', zero: false, vals: [9.6, 10.2, 11.4, 12.8, 14.2, 15.0, 14.6, 13.8, 12.9, 12.2, 11.8, 11.0, 10.4, 9.8, 9.0, 8.6, 8.1, 7.9, 7.4, 7.0, 6.8, 6.5, 6.2, 6.0] },
} as const;
export type ForecastTab = keyof typeof FORECAST;
export const FORECAST_HOURS = ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00'];

/** Rain bars in the precipitation instrument (relative heights, % of 36 px). */
export const RAIN_BARS: Array<[number, string]> = [
  [8, '#C9D6EA'], [10, '#C9D6EA'], [16, '#C9D6EA'], [28, '#A9C0E3'], [45, '#7FA2D8'], [70, '#4A7FD0'], [90, '#4A7FD0'], [100, '#4A7FD0'],
  [84, '#4A7FD0'], [64, '#7FA2D8'], [50, '#A9C0E3'], [38, '#C9D6EA'], [26, '#C9D6EA'], [18, '#C9D6EA'], [12, '#C9D6EA'], [8, '#C9D6EA'],
];
