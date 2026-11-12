import type { CSSProperties } from 'react';
import type { PropertyStatus, WarningLevel } from '@fastighetsradar/domain';

/**
 * Design tokens extracted verbatim from the approved prototype
 * (FastighetsRadar.dc.html). Do not "improve" these values – they are the design.
 */

export const FONT_SANS = "var(--font-geist-sans), 'Geist', system-ui, sans-serif";
export const FONT_MONO = "var(--font-geist-mono), 'Geist Mono', monospace";

export const C = {
  ink: '#14171A',
  inkHover: '#2A2F34',
  text2: '#4A5157',
  text3: '#6B737B',
  text4: '#9AA1A8',
  sep: '#C4C9CD',
  page: '#F3F4F2',
  sidebar: '#F7F8F6',
  white: '#FFFFFF',
  chip: '#F1F3F2',
  rowHover: '#F6F7F6',
  tile: '#F6F7F6',
  track: '#F1F3F2',
  trackOff: '#E6E9E8',
  toggleOff: '#DDE1E0',
  toggleOn: 'oklch(0.62 0.13 155)',
  mapBg: '#EDF0F0',
  live: 'oklch(0.65 0.14 155)',
  demo: 'oklch(0.7 0.13 75)',
} as const;

export interface SeverityStyle {
  label: string;
  c: string;
  bg: string;
  hex: number;
  hx: string;
}

export const SEV: Record<Exclude<PropertyStatus, 'unknown'>, SeverityStyle> & { unknown: SeverityStyle } = {
  normal: { label: 'Normal', c: 'oklch(0.55 0.12 155)', bg: 'oklch(0.95 0.035 155)', hex: 0x3fa66b, hx: '#3FA66B' },
  monitor: { label: 'Monitor', c: 'oklch(0.54 0.12 245)', bg: 'oklch(0.95 0.03 245)', hex: 0x4a7fd0, hx: '#4A7FD0' },
  warning: { label: 'Warning', c: 'oklch(0.6 0.15 55)', bg: 'oklch(0.95 0.045 65)', hex: 0xe08a2e, hx: '#E08A2E' },
  critical: { label: 'Critical', c: 'oklch(0.57 0.19 27)', bg: 'oklch(0.95 0.04 25)', hex: 0xd8473a, hx: '#D8473A' },
  // Not in the prototype: used when status cannot be determined (missing data ≠ normal).
  unknown: { label: 'Unknown', c: '#6B737B', bg: '#F1F3F2', hex: 0x9aa1a8, hx: '#9AA1A8' },
};

export const STATUS_ORDER = ['normal', 'monitor', 'warning', 'critical'] as const;

export const WL: Record<WarningLevel, { bg: string; fg: string; label: string }> = {
  Yellow: { bg: 'oklch(0.94 0.08 95)', fg: 'oklch(0.45 0.1 85)', label: 'Yellow' },
  Orange: { bg: 'oklch(0.93 0.07 60)', fg: 'oklch(0.5 0.14 50)', label: 'Orange' },
  // Red is not in the prototype; added so a real SMHI red warning can be rendered.
  Red: { bg: 'oklch(0.93 0.06 25)', fg: 'oklch(0.48 0.18 27)', label: 'Red' },
  VMA: { bg: 'oklch(0.94 0.04 25)', fg: 'oklch(0.5 0.17 27)', label: 'VMA' },
  Info: { bg: 'oklch(0.95 0.03 240)', fg: 'oklch(0.48 0.1 245)', label: 'Info' },
};

/* Shared surfaces ------------------------------------------------------ */

const shadow = '0 1px 2px rgba(20,23,26,0.03),0 12px 32px -18px rgba(20,23,26,0.14)';

/** Large rounded card (radius 26). */
export const card: CSSProperties = {
  background: C.white,
  borderRadius: 26,
  border: '1px solid rgba(20,23,26,0.05)',
  boxShadow: shadow,
};

/** KPI / instrument card (radius 22). */
export const smallCard: CSSProperties = {
  background: C.white,
  borderRadius: 22,
  padding: 18,
  border: '1px solid rgba(20,23,26,0.05)',
  boxShadow: shadow,
};

/** Frosted glass overlay used on 3D and map panels. */
export const glass = (alpha = 0.62, blur = 16): CSSProperties => ({
  background: `rgba(255,255,255,${alpha})`,
  backdropFilter: `blur(${blur}px)`,
  WebkitBackdropFilter: `blur(${blur}px)`,
  border: '1px solid rgba(255,255,255,0.9)',
});

export const cardTitle: CSSProperties = { fontSize: 15, fontWeight: 600 };
export const cardSub: CSSProperties = { fontSize: 12, color: C.text3 };
export const monoChip: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10.5,
  padding: '3px 7px',
  borderRadius: 6,
  background: C.chip,
  color: C.text2,
};
export const tile: CSSProperties = { padding: 12, borderRadius: 14, background: C.tile };
