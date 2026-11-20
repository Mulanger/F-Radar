/** Password strength heuristic and meter labels from the approved sign-up design. */

export type Strength = 0 | 1 | 2 | 3 | 4;

/** 0 = empty; below the minimum length the score is capped at 1 ("Svagt"). */
export function passwordStrength(pw: string, minLength: number): Strength {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= minLength) s++;
  if (/[a-zåäö]/.test(pw) && /[A-ZÅÄÖ]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9åäöÅÄÖ]/.test(pw)) s++;
  if (pw.length < minLength) s = Math.min(s, 1);
  return Math.max(1, s) as Strength;
}

const RED = 'oklch(0.57 0.19 27)';
const AMBER = 'oklch(0.6 0.15 55)';
const GREEN = 'oklch(0.55 0.12 155)';
const TRACK = '#E6E9E8';

export function strengthMeter(score: Strength, minLength: number) {
  const colors = [TRACK, RED, AMBER, GREEN, GREEN];
  const labels = [`Minst ${minLength} tecken`, 'Svagt', 'Okej', 'Starkt', 'Mycket starkt'];
  return {
    bars: [0, 1, 2, 3].map((i) => (i < score ? colors[score]! : TRACK)),
    color: score ? colors[score]! : '#9AA1A8',
    label: labels[score]!,
  };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
