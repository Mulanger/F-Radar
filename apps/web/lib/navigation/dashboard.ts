const sections = {
  overview: 'Översikt',
  properties: 'Fastigheter',
  alerts: 'Larm',
  profile: 'Profil',
  acknowledgements: 'Kvitteringar',
} as const;

export type DashboardSection = keyof typeof sections;
export type ReturnTarget = { href: string; label: string };

export function dashboardSection(value: string | null | undefined): DashboardSection | undefined {
  return value && Object.hasOwn(sections, value) ? value as DashboardSection : undefined;
}

export function sectionTarget(basePath: string, section: DashboardSection): ReturnTarget {
  return { href: `${basePath}/${section}`, label: sections[section] };
}

export function propertyHref(basePath: string, id: string, from?: DashboardSection) {
  const path = `${basePath}/properties/${encodeURIComponent(id)}`;
  return from ? `${path}?via=${from}` : path;
}

export function propertySmsHref(id: string, propertyFrom?: DashboardSection) {
  const query = new URLSearchParams({ property: id, via: 'property' });
  if (propertyFrom) query.set('propertyVia', propertyFrom);
  return `/sms-rules?${query}`;
}

type RecordedReturn = { href: string; previous: string };
let pending: RecordedReturn | undefined;

function currentHref() {
  return window.location.pathname + window.location.search;
}

function savedReturn(): RecordedReturn | undefined {
  const state = window.history.state?.fastighetsradarReturn;
  return state?.href === currentHref() ? state : undefined;
}

export function recordDashboardDeparture(href: string, replacesChild = false) {
  const previous = replacesChild ? savedReturn()?.previous : currentHref();
  pending = previous && previous !== href ? { href, previous } : undefined;
  window.addEventListener('popstate', clearPending, { once: true });
}

function clearPending() {
  pending = undefined;
}

export function completeDashboardArrival() {
  if (!pending || pending.href !== currentHref()) return;
  window.history.replaceState({ ...window.history.state, fastighetsradarReturn: pending }, '');
  clearPending();
}

export function canReturnThroughHistory(href: string) {
  const previous = savedReturn()?.previous;
  return href.includes('?') ? previous === href : previous?.split('?')[0] === href;
}
