'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OrganizationSettingsResponseSchema, TRAFFIC_RADIUS, formatTrafficRadius, type OrganizationSettingsResponse } from '@fastighetsradar/domain';
import { card, cardSub, cardTitle } from '@/lib/design/tokens';
import s from './SettingsPage.module.css';

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

/** Wait after the last change before saving, so dragging the slider saves once. */
export const SAVE_DELAY_MS = 600;

const TICKS = [100, 1000, 2000, 3000];
const pctOf = (v: number) => ((v - TRAFFIC_RADIUS.min) / (TRAFFIC_RADIUS.max - TRAFFIC_RADIUS.min)) * 100;
const spoken = (v: number) => formatTrafficRadius(v).replace(' km', ' kilometer').replace(' m', ' meter');

/** Inställningar: organization-wide settings (today the Trafikverket distance). */
export function SettingsPage({ initial, back, account }: { initial: OrganizationSettingsResponse; back?: React.ReactNode; account?: React.ReactNode }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial.trafficRadiusM);
  const [value, setValue] = useState(initial.trafficRadiusM);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const save = async (next: number) => {
    setState({ kind: 'saving' });
    try {
      const r = await fetch('/api/app/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ trafficRadiusM: next }),
      });
      const json: unknown = await r.json().catch(() => null);
      if (r.status === 401) throw new Error('Du är inte inloggad längre. Ladda om sidan och försök igen.');
      if (!r.ok) throw new Error((json as { title?: string } | null)?.title ?? 'Inställningen kunde inte sparas.');
      const parsed = OrganizationSettingsResponseSchema.parse(json);
      setSaved(parsed.trafficRadiusM);
      setValue(parsed.trafficRadiusM);
      setState({ kind: 'saved' });
      // Property pages and the feed use the new distance.
      router.refresh();
    } catch (e) {
      setValue(saved);
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Inställningen kunde inte sparas.' });
    }
  };

  const change = (next: number) => {
    setValue(next);
    setState({ kind: 'idle' });
    if (timer.current) clearTimeout(timer.current);
    if (next === saved) return;
    timer.current = setTimeout(() => void save(next), SAVE_DELAY_MS);
  };

  return (
    <div className={s.page}>
      {back}
      <div>
        <h1 className={s.h1}>Inställningar</h1>
        <p style={{ ...cardSub, margin: 0 }}>Gäller hela organisationen och alla fastigheter.</p>
      </div>
      {!initial.canEdit && <p style={{ ...cardSub, margin: 0 }}>Du har läsbehörighet. En organisationsadministratör kan ändra inställningarna.</p>}

      <section style={{ ...card, padding: 24 }} className={s.card} aria-labelledby="traffic-title">
        <div className={s.head}>
          <div style={{ minWidth: 0 }}>
            <h2 id="traffic-title" style={{ ...cardTitle, margin: 0 }}>Trafikverket – avstånd från fastigheten</h2>
            <p style={{ ...cardSub, margin: '4px 0 0' }}>Hur långt bort vägarbeten, avstängningar, olyckor och köer ska räknas.</p>
          </div>
          <output className={s.value} htmlFor="traffic-radius" aria-live="polite">
            {formatTrafficRadius(value)}
          </output>
        </div>

        <div className={s.sliderWrap}>
          <input
            id="traffic-radius"
            className={s.slider}
            type="range"
            min={TRAFFIC_RADIUS.min}
            max={TRAFFIC_RADIUS.max}
            step={TRAFFIC_RADIUS.step}
            value={value}
            disabled={!initial.canEdit}
            aria-label="Avstånd för Trafikverkets händelser"
            aria-valuetext={spoken(value)}
            style={{ '--pct': `${pctOf(value)}%` } as React.CSSProperties}
            onChange={(e) => change(Number(e.target.value))}
          />
          <div className={s.ticks} aria-hidden="true">
            {TICKS.map((t) => (
              <span key={t} style={{ left: `${pctOf(t)}%` }}>
                {formatTrafficRadius(t)}
              </span>
            ))}
          </div>
        </div>

        <div className={s.foot}>
          <span className={s.status} role="status">
            {state.kind === 'saving' && 'Sparar…'}
            {state.kind === 'saved' && <span className={s.ok}>Sparat · gäller direkt</span>}
            {state.kind === 'error' && <span className={s.err}>{state.message}</span>}
            {state.kind === 'idle' && value === TRAFFIC_RADIUS.default && 'Standard'}
          </span>
          {initial.canEdit && value !== TRAFFIC_RADIUS.default && (
            <button type="button" className={s.reset} onClick={() => change(TRAFFIC_RADIUS.default)}>
              Återställ till {formatTrafficRadius(TRAFFIC_RADIUS.default)}
            </button>
          )}
        </div>

        <ul className={s.notes}>
          <li>Gäller fastighetssidan, händelseflödet och kartan. Trafik-SMS skickas aldrig för händelser längre bort än så.</li>
          <li>Ett kortare avstånd tar bort händelserna utanför direkt. Ett längre avstånd hämtar fler händelser från Trafikverket inom några minuter.</li>
          <li>Väder, VMA och strömavbrott påverkas inte: de matchas mot fastighetens läge, kommun eller län.</li>
        </ul>
      </section>
      {account}
    </div>
  );
}
