'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  PropertyCreateSchema,
  configureSwedishValidation,
  fieldLabelSv,
  PropertyUpdateSchema,
  SWEDEN_BOUNDS,
  type AddressSuggestionDto,
  type GeocodeMetadata,
  type GeocodingSuggestionsResponse,
  type PropertySnapshot,
} from '@fastighetsradar/domain';
import { C, FONT_MONO, card } from '@/lib/design/tokens';

const LocationPickerMap = dynamic(() => import('../maps/LocationPickerMap').then((m) => m.LocationPickerMap), { ssr: false });

/** Default map centre when placing a pin manually (Stockholm city). */
const DEFAULT_POINT = { lat: 59.3293, lon: 18.0686 };
const DEBOUNCE_MS = 350;

type Mode = { kind: 'create' } | { kind: 'edit'; snapshot: PropertySnapshot };

const input: React.CSSProperties = {
  height: 44, boxSizing: 'border-box', width: '100%', padding: '0 14px', borderRadius: 14, border: '1px solid rgba(20,23,26,0.1)',
  background: C.white, font: 'inherit', fontSize: 14, color: C.ink, outline: 'none',
};
const label: React.CSSProperties = { fontSize: 12, color: C.text3, display: 'block', marginBottom: 6 };
const primaryBtn: React.CSSProperties = {
  height: 44, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 20px', borderRadius: 22, background: C.ink, color: '#fff', border: 'none',
  fontSize: 13.5, fontWeight: 500, cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  height: 44, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 16px', borderRadius: 22, background: C.white, color: C.ink,
  border: '1px solid rgba(20,23,26,0.1)', fontSize: 13.5, cursor: 'pointer',
};

configureSwedishValidation();

const PRECISION_SV: Record<string, string> = { building: 'byggnad', street: 'gata', approximate: 'ungefärlig' };

/** Swedish messages for API problem statuses (API titles are English, RFC 9457). */
const STATUS_SV: Record<number, string> = {
  400: 'Uppgifterna är ogiltiga.',
  401: 'Din inloggning har gått ut – logga in igen.',
  403: 'Du saknar behörighet eller har ingen organisation vald.',
  404: 'Fastigheten hittades inte.',
  409: 'Gränsen för antal fastigheter är nådd.',
  429: 'För många förfrågningar – vänta en stund.',
  503: 'Tjänsten är tillfälligt otillgänglig.',
};

function precisionNote(meta: GeocodeMetadata | null): string | null {
  if (!meta) return null;
  if (meta.provider === 'manual_pin') return 'Manuell position – dra nålen till byggnaden.';
  if (meta.precision === 'building') return 'Adressen matchade en byggnad. Kontrollera nålen och justera vid behov.';
  return 'Ungefärlig träff (ingen exakt byggnad). Dra nålen till byggnaden innan du sparar.';
}

async function problemMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  if (body?.errors?.length) return body.errors.map((e: { path: string; message: string }) => `${fieldLabelSv(e.path || 'input')}: ${e.message}`).join(' · ');
  return STATUS_SV[res.status] ?? `Förfrågan misslyckades (${res.status}).`;
}

/**
 * Add / edit property dialog.
 *
 * Flow: type a Swedish address → debounced Geoapify suggestions (via the authenticated
 * server proxy) → pick one → confirm or drag the pin → save. Without a working geocoder the
 * user can place the pin manually. Geocoding happens only here, never on dashboard views.
 */
export function PropertyEditorDialog({
  mode,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: Mode;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDeleted?: () => void;
}) {
  const editing = mode.kind === 'edit' ? mode.snapshot.property : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [query, setQuery] = useState(editing?.address ?? '');
  const [address, setAddress] = useState(editing?.address ?? '');
  const [suggestions, setSuggestions] = useState<AddressSuggestionDto[]>([]);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'error' | 'unavailable' | 'rate_limited' | 'empty'>('idle');
  const [attribution, setAttribution] = useState('Drivs av Geoapify · © OpenStreetMap-bidragsgivare');
  const [geocode, setGeocode] = useState<GeocodeMetadata | null>(null);
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(editing ? editing.location : null);
  const [pointTouched, setPointTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const skipSearchFor = useRef<string | null>(editing?.address ?? null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  // Debounced, cancellable autocomplete.
  useEffect(() => {
    const q = query.trim();
    if (q === skipSearchFor.current) return;
    if (q.length < 3) {
      setSuggestions([]);
      setSearchState('idle');
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearchState('loading');
      try {
        const res = await fetch(`/api/app/geocoding/suggestions?q=${encodeURIComponent(q)}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
        if (!res.ok) {
          setSearchState(res.status === 429 ? 'rate_limited' : 'error');
          setSuggestions([]);
          return;
        }
        const body = (await res.json()) as GeocodingSuggestionsResponse;
        setAttribution(body.attribution);
        setSuggestions(body.suggestions);
        setSearchState(body.status === 'geocoding_unavailable' ? 'unavailable' : body.status === 'rate_limited' ? 'rate_limited' : body.suggestions.length ? 'idle' : 'empty');
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setSearchState('error');
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const pick = (s: AddressSuggestionDto) => {
    skipSearchFor.current = s.label;
    setQuery(s.label);
    setAddress(s.label);
    setSuggestions([]);
    setSearchState('idle');
    setGeocode({
      provider: 'geoapify',
      placeId: s.placeId,
      label: s.label,
      resultType: s.resultType,
      precision: s.precision,
      confidence: s.confidence,
      geocodedPoint: { lat: s.lat, lon: s.lon },
      postcode: s.postcode,
      city: s.city,
      municipality: s.municipality,
    });
    setPoint({ lat: s.lat, lon: s.lon });
    setPointTouched(false);
    if (!name.trim()) setName([s.street, s.housenumber].filter(Boolean).join(' ') || s.label.split(',')[0] || '');
  };

  const useManualPin = () => {
    setGeocode({ provider: 'manual_pin', precision: 'unknown' });
    setAddress(query.trim());
    setSuggestions([]);
    setPoint((p) => p ?? DEFAULT_POINT);
  };

  const addressChanged = editing ? address.trim() !== editing.address || geocode !== null : true;
  const outsideSweden =
    !!point && (point.lat < SWEDEN_BOUNDS.minLat || point.lat > SWEDEN_BOUNDS.maxLat || point.lon < SWEDEN_BOUNDS.minLon || point.lon > SWEDEN_BOUNDS.maxLon);

  const payload = useMemo(() => {
    if (!point) return null;
    if (!editing) {
      if (!geocode) return null;
      return { name: name.trim(), address: (geocode.provider === 'manual_pin' ? query : address).trim(), location: point, geocode };
    }
    const patch: Record<string, unknown> = {};
    if (name.trim() !== editing.name) patch.name = name.trim();
    if (geocode) {
      patch.address = (geocode.provider === 'manual_pin' ? query : address).trim();
      patch.geocode = geocode;
      patch.location = point;
    } else if (pointTouched) {
      patch.location = point;
    }
    return patch;
  }, [point, editing, geocode, name, query, address, pointTouched]);

  const save = async () => {
    setError(null);
    if (!payload) {
      setError(editing ? 'Inget att spara.' : 'Välj ett adressförslag eller placera nålen manuellt.');
      return;
    }
    const parsed = editing ? PropertyUpdateSchema.safeParse(payload) : PropertyCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${fieldLabelSv(i.path.join('.') || 'input')}: ${i.message}`).join(' · '));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/app/properties/${editing.id}` : '/api/app/properties', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        setError(await problemMessage(res));
        return;
      }
      const body = await res.json();
      onSaved(body.property.id);
    } catch {
      setError('Nätverksfel – fastigheten sparades inte.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/app/properties/${editing.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        setError(await problemMessage(res));
        return;
      }
      onDeleted?.();
    } catch {
      setError('Nätverksfel – fastigheten togs inte bort.');
    } finally {
      setSaving(false);
    }
  };

  const note = precisionNote(geocode);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="property-editor-title"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(20,23,26,0.28)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'grid', placeItems: 'center', padding: 16, boxSizing: 'border-box', animation: 'frFade .2s ease both',
      }}
    >
      <div style={{ ...card, width: 'min(880px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', padding: 24, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div id="property-editor-title" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em' }}>{editing ? 'Redigera fastighet' : 'Lägg till fastighet'}</div>
            <div style={{ fontSize: 12.5, color: C.text3, marginTop: 4 }}>
              {editing ? 'Byt namn, ändra adressen eller korrigera positionen på kartan.' : 'Sök en svensk adress och bekräfta sedan positionen på kartan.'}
            </div>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="Stäng" style={{ ...secondaryBtn, width: 40, height: 40, padding: 0, justifyContent: 'center' }}>
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <div>
              <label htmlFor="pe-name" style={label}>Fastighetens namn</label>
              <input id="pe-name" ref={nameRef} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="t.ex. Sveavägen 42" style={input} />
            </div>
            <div style={{ position: 'relative' }}>
              <label htmlFor="pe-address" style={label}>Adress</label>
              <input
                id="pe-address"
                value={query}
                maxLength={200}
                autoComplete="off"
                role="combobox"
                aria-expanded={suggestions.length > 0}
                aria-controls="pe-suggestions"
                onChange={(e) => {
                  skipSearchFor.current = null;
                  setQuery(e.target.value);
                  if (geocode?.provider === 'geoapify') setGeocode(null);
                }}
                placeholder="Gata och nummer, ort"
                style={input}
              />
              {suggestions.length > 0 && (
                <div
                  id="pe-suggestions"
                  role="listbox"
                  style={{
                    position: 'absolute', top: 72, left: 0, right: 0, zIndex: 5, padding: 6, borderRadius: 16, background: 'rgba(255,255,255,0.97)',
                    border: '1px solid rgba(20,23,26,0.06)', boxShadow: '0 24px 60px -20px rgba(20,23,26,0.3)',
                  }}
                >
                  {suggestions.map((s) => (
                    <div
                      key={s.placeId ?? `${s.lat},${s.lon}`}
                      role="option"
                      aria-selected={false}
                      tabIndex={0}
                      className="fr-hover-soft"
                      onClick={() => pick(s)}
                      onKeyDown={(e) => e.key === 'Enter' && pick(s)}
                      style={{ padding: '10px 12px', borderRadius: 12, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10 }}
                    >
                      <span style={{ fontSize: 13.5 }}>{s.label}</span>
                      <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: C.text4, whiteSpace: 'nowrap' }}>{PRECISION_SV[s.precision] ?? s.precision}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: 10.5, color: C.text4, padding: '6px 12px 2px' }}>{attribution}</div>
                </div>
              )}
              <div style={{ fontSize: 11.5, color: C.text4, marginTop: 6, minHeight: 16 }} aria-live="polite">
                {searchState === 'loading' && 'Söker…'}
                {searchState === 'empty' && 'Ingen svensk adress hittades. Kontrollera stavningen eller placera nålen manuellt.'}
                {searchState === 'unavailable' && 'Adressökningen är inte tillgänglig just nu – placera nålen manuellt.'}
                {searchState === 'rate_limited' && 'För många sökningar – vänta en stund eller placera nålen manuellt.'}
                {searchState === 'error' && 'Adressökningen misslyckades – försök igen eller placera nålen manuellt.'}
              </div>
              {geocode?.provider !== 'manual_pin' && (
                <button type="button" onClick={useManualPin} style={{ marginTop: 4, padding: 0, border: 'none', background: 'none', color: C.text2, fontSize: 12.5, textDecoration: 'underline', cursor: 'pointer' }}>
                  Hittar du inte adressen? Placera nålen manuellt
                </button>
              )}
            </div>
            <div style={{ padding: 12, borderRadius: 14, background: C.tile, fontSize: 12, color: C.text3, lineHeight: 1.5 }}>
              {point ? (
                <>
                  <div>
                    Position <b style={{ fontFamily: FONT_MONO, fontWeight: 500, color: C.ink }}>{point.lat.toFixed(5)}, {point.lon.toFixed(5)}</b>
                  </div>
                  {note && <div style={{ marginTop: 4 }}>{note}</div>}
                  {outsideSweden && <div style={{ marginTop: 4, color: 'oklch(0.55 0.17 28)' }}>Positionen ligger utanför Sverige.</div>}
                </>
              ) : (
                'Ingen position ännu.'
              )}
              <div style={{ marginTop: 6, color: C.text4 }}>
                Adresspunkter kommer från Geoapify/OpenStreetMap och är inte officiella fastighetsgränser.
              </div>
            </div>
          </div>

          <div style={{ flex: '1.2 1 340px', minHeight: 320, position: 'relative', borderRadius: 20, overflow: 'hidden', background: C.mapBg, border: '1px solid rgba(20,23,26,0.05)' }}>
            {point ? (
              <LocationPickerMap
                point={point}
                onChange={(p) => {
                  setPoint(p);
                  setPointTouched(true);
                }}
              />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24, fontSize: 13, color: C.text3 }}>
                Välj en adress för att se den på kartan.
              </div>
            )}
          </div>
        </div>

        {error && (
          <div role="alert" style={{ padding: '10px 14px', borderRadius: 14, background: 'oklch(0.95 0.04 25)', color: 'oklch(0.5 0.17 27)', fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            {editing &&
              (confirmDelete ? (
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  Ta bort ”{editing.name}” permanent?
                  <button onClick={remove} disabled={saving} style={{ ...primaryBtn, height: 36, background: 'oklch(0.57 0.19 27)' }}>
                    Ta bort
                  </button>
                  <button onClick={() => setConfirmDelete(false)} disabled={saving} style={{ ...secondaryBtn, height: 36 }}>
                    Behåll
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirmDelete(true)} disabled={saving} style={{ ...secondaryBtn, color: 'oklch(0.5 0.17 27)' }}>
                  Ta bort fastighet
                </button>
              ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} disabled={saving} style={secondaryBtn}>
              Avbryt
            </button>
            <button
              className="fr-hover-dark"
              onClick={save}
              disabled={saving || outsideSweden || (!editing && (!geocode || !point || !name.trim())) || (!!editing && !addressChanged && !pointTouched && name.trim() === editing.name)}
              style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Sparar…' : editing ? 'Spara ändringar' : 'Spara fastighet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
