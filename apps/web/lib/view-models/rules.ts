import type { AlertRule, PropertySnapshot } from '@fastighetsradar/domain';
import { isOfficialLevel, metricValue } from './snapshot';

export interface RuleView {
  id: string;
  code: string;
  name: string;
  cond: string;
  on: boolean;
  /** Whether the rule's condition is met by the CURRENT displayed values. */
  hit: boolean;
}

export function eventCounts(s: PropertySnapshot) {
  const crisis = s.events.filter((e) => e.category === 'Crisis').length;
  const traffic = s.events.filter((e) => e.category === 'Traffic').length;
  return { crisis, traffic, other: s.events.length - crisis - traffic };
}

function compare(op: AlertRule['operator'], value: number | null, threshold: number | null): boolean {
  if (value === null || threshold === null) return false; // unknown never triggers
  switch (op) {
    case 'gt': return value > threshold;
    case 'gte': return value >= threshold;
    case 'lt': return value < threshold;
    case 'lte': return value <= threshold;
    case 'eq': return value === threshold;
    default: return false;
  }
}

/**
 * Evaluates whether a rule's condition is currently met, for DISPLAY only
 * ("Triggered today" / "Armed"). This is not the alert engine: no SMS is sent and no
 * hysteresis/cooldown applies (IMPLEMENTATION.md §12 – Agent 2+).
 */
export function isRuleHit(rule: AlertRule, s: PropertySnapshot): boolean {
  switch (rule.metricKey) {
    case 'warning.level':
      return s.warnings.some((w) => isOfficialLevel(w.level));
    case 'crisis.regional_publication':
      return eventCounts(s).crisis > 0;
    case 'water.level_relative_to_mean': {
      const lvl = s.flood.waterBody?.level;
      const v = lvl && lvl.availability === 'ok' && typeof lvl.value === 'number' ? lvl.value : null;
      return compare(rule.operator, v, rule.threshold);
    }
    case 'weather.precipitation_24h':
    case 'weather.wind_gust':
      return compare(rule.operator, metricValue(s, rule.metricKey), rule.threshold);
    default:
      return false;
  }
}

export function rulesFor(s: PropertySnapshot, isRuleOn: (id: string, fallback: boolean) => boolean): RuleView[] {
  return s.alertRules.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    cond: r.conditionLabel,
    on: isRuleOn(r.id, r.enabled),
    hit: isRuleHit(r, s),
  }));
}
