/** Inline SVG icons copied verbatim from the prototype. */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number; sw?: number };
const base = (size: number, sw: number, rest: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: sw,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  ...rest,
});

export const IconDashboard = ({ size = 18, sw = 1.7, ...r }: P) => (
  <svg {...base(size, sw, r)}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
);
export const IconBuilding = ({ size = 18, sw = 1.7, ...r }: P) => (
  <svg {...base(size, sw, r)}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 21v-4h6v4M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01" /></svg>
);
export const IconBuildingSimple = ({ size = 16, sw = 1.7, ...r }: P) => (
  <svg {...base(size, sw, r)}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 21v-4h6v4" /></svg>
);
export const IconAlert = ({ size = 18, sw = 1.7, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
);
export const IconMap = ({ size = 18, sw = 1.7, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3z" /><path d="M9 3v15M15 6v15" /></svg>
);
export const IconAnalytics = ({ size = 18, sw = 1.7, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M3 3v18h18" /><path d="M7 16v-4M12 16V8M17 16v-7" /></svg>
);
export const IconMessage = ({ size = 18, sw = 1.7, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
);
export const IconSliders = ({ size = 18, sw = 1.7, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>
);
export const IconSearch = ({ size = 17, sw = 1.8, ...r }: P) => (
  <svg {...base(size, sw, r)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const IconChevronDown = ({ size = 14, sw = 2, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="m6 9 6 6 6-6" /></svg>
);
export const IconChevronLeft = ({ size = 16, sw = 2, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="m15 6-6 6 6 6" /></svg>
);
export const IconChevronRight = ({ size = 16, sw = 2, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="m9 6 6 6-6 6" /></svg>
);
export const IconCalendar = ({ size = 16, sw = 1.7, ...r }: P) => (
  <svg {...base(size, sw, r)}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
);
export const IconBell = ({ size = 18, sw = 1.7, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
);
export const IconBellSimple = ({ size = 15, sw = 1.8, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /></svg>
);
export const IconPlus = ({ size = 15, sw = 2, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconShield = ({ size = 15, sw = 1.8, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M12 8v4M12 16h.01" /></svg>
);
export const IconRain = ({ size = 15, sw = 1.8, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3" /><path d="M16 14v6M8 14v6M12 16v6" /></svg>
);
export const IconArrowLeft = ({ size = 15, sw = 2, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
);
export const IconThermometer = ({ size = 14, sw = 1.8, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z" /></svg>
);
export const IconWind = ({ size = 14, sw = 1.8, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2" /></svg>
);
export const IconDrop = ({ size = 14, sw = 1.8, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z" /></svg>
);
export const IconLeaf = ({ size = 14, sw = 1.8, ...r }: P) => (
  <svg {...base(size, sw, r)}><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z" /><path d="M2 21c0-3 1.9-5.4 5.1-6" /></svg>
);
