/**
 * Kvittering i händelseflödet: which feed rows someone in the organization must acknowledge.
 *
 * Official warnings (SMHI yellow/orange/red), VMA and anything critical, and power outages that
 * affect the property – while they are still going on. Ordinary traffic notices (roadworks, about
 * twenty a day) are information only. An ended or cancelled row never needs acknowledging, and only
 * the latest row of an event asks for it (an older row is superseded by the update that followed).
 */
export interface FeedAckInput {
  sourceId: string;
  changeType: string;
  /** Change severity as stored: critical | warning | monitor | info | unknown. */
  severity: string;
  /** The underlying event (warning, outage, …) is still active. */
  eventActive: boolean;
  /** A later row of the same event exists for this property. */
  superseded?: boolean;
}

export function feedNeedsAck(x: FeedAckInput): boolean {
  if (x.changeType !== 'new' && x.changeType !== 'updated') return false;
  if (!x.eventActive || x.superseded) return false;
  if (x.severity === 'critical') return true;
  if (x.sourceId === 'smhi_warnings' || x.sourceId === 'utility_outages') return x.severity === 'warning' || x.severity === 'monitor';
  return false;
}

/** Severity rank used to identify an escalation in the alarm notification list. */
export const FEED_ACK_SEVERITY_RANK: Record<string, number> = { critical: 3, warning: 2, monitor: 1 };
