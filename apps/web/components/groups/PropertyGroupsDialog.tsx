'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { PROPERTY_GROUP_NAME_MAX, PROPERTY_GROUPS_MAX, propertyGroupKey, type Portfolio } from '@fastighetsradar/domain';
import { groupOptions } from '@/lib/view-models/groups';
import { GroupUsedBySmsRulesError, type GroupChangeRequest } from '@/lib/groups/store';
import { RulePropertySelect } from '../notifications/RulePropertySelect';
import frame from '../properties/PropertyImport.module.css';
import styles from './PropertyGroups.module.css';

type View = { kind: 'list' } | { kind: 'members'; id: string; label: string; selected: string[]; isNew: boolean };

/**
 * "Grupper" on the property page (docs/plans/skalning.md, Fas 4 / S-20): create, rename and delete the
 * organization's groups, and pick each group's properties with search and "Markera alla som syns" –
 * putting 150 of 500 properties in a group is a search and one click.
 */
export function PropertyGroupsDialog({
  portfolio,
  demo,
  change,
  onClose,
}: {
  portfolio: Portfolio;
  demo: boolean;
  /** Runs one change and resolves with the group's id; rejects with a Swedish message. */
  change: (c: GroupChangeRequest) => Promise<string>;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ id: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const options = useMemo(() => groupOptions(portfolio).filter((g) => g.id !== 'all'), [portfolio]);
  const properties = useMemo(
    () =>
      portfolio.properties
        .map((s) => ({ id: s.property.id, name: s.property.name, detail: [s.property.address, s.property.municipality ?? s.property.area].filter(Boolean).join(' · ') }))
        .sort((a, b) => a.name.localeCompare(b.name, 'sv-SE')),
    [portfolio.properties],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const taken = (name: string, except?: string) => options.some((g) => g.id !== except && propertyGroupKey(g.label) === propertyGroupKey(name));
  const validName = (name: string, except?: string): string | null => {
    const n = name.trim();
    if (!n) return 'Skriv ett namn på gruppen.';
    if (n.length > PROPERTY_GROUP_NAME_MAX) return `Namnet får vara högst ${PROPERTY_GROUP_NAME_MAX} tecken.`;
    if (taken(n, except)) return 'Det finns redan en grupp med det namnet.';
    return null;
  };

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gruppen kunde inte sparas.');
    } finally {
      setBusy(false);
    }
  }

  // A new group is created when its properties are saved, so cancelling leaves no empty group behind.
  function startCreate(e: FormEvent) {
    e.preventDefault();
    const problem = validName(newName);
    if (problem) return setError(problem);
    if (options.length >= PROPERTY_GROUPS_MAX) return setError(`En organisation kan ha högst ${PROPERTY_GROUPS_MAX} grupper.`);
    setError(null);
    setView({ kind: 'members', id: '', label: newName.trim(), selected: [], isNew: true });
  }

  function saveMembers(v: Extract<View, { kind: 'members' }>) {
    void run(async () => {
      if (v.isNew) {
        await change({ kind: 'create', name: v.label, propertyIds: v.selected });
        setNewName('');
      } else {
        await change({ kind: 'members', id: v.id, propertyIds: v.selected });
      }
      setSaved(`${v.label}: ${v.selected.length} ${v.selected.length === 1 ? 'fastighet' : 'fastigheter'} sparade.`);
      setView({ kind: 'list' });
    });
  }

  function saveRename() {
    if (!renaming) return;
    const problem = validName(renaming.name, renaming.id);
    if (problem) return setError(problem);
    void run(async () => {
      await change({ kind: 'rename', id: renaming.id, name: renaming.name });
      setRenaming(null);
    });
  }

  function remove(id: string) {
    void run(async () => {
      try {
        await change({ kind: 'remove', id });
      } catch (err) {
        if (!(err instanceof GroupUsedBySmsRulesError)) throw err;
        setBlocked({ id, message: err.message });
      }
      setConfirming(null);
    });
  }

  return (
    <div className={frame.backdrop} role="dialog" aria-modal="true" aria-labelledby="property-groups-title" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={frame.dialog} style={{ width: 'min(720px, 100%)' }}>
        <div className={frame.head}>
          <div>
            <h2 id="property-groups-title" className={frame.title}>{view.kind === 'members' ? (view.isNew ? `Ny grupp: ${view.label}` : `Fastigheter i ${view.label}`) : 'Grupper'}</h2>
            <p className={frame.lead}>
              {view.kind === 'members'
                ? 'Sök på namn, adress eller ort och markera fastigheterna. En fastighet kan ligga i flera grupper.'
                : 'Dela in fastigheterna i områden, bolag eller förvaltare. Gruppen väljs sedan i översikten, listan, kartan och larmen.'}
            </p>
          </div>
          <button className={`${frame.button} ${frame.close}`} onClick={onClose} disabled={busy} aria-label="Stäng">✕</button>
        </div>

        {demo && <p className={frame.demo}>Demoläge: grupperna sparas inte – de finns bara kvar tills sidan laddas om.</p>}
        {error && <p className={frame.error} role="alert">{error}</p>}
        {saved && <p className={frame.notice} role="status">{saved}</p>}

        {view.kind === 'members' ? (
          <>
            <RulePropertySelect
              properties={properties}
              selected={view.selected}
              onChange={(selected) => setView({ ...view, selected })}
              searchLabel={`Sök fastighet för ${view.label}`}
              listHeight={340}
            />
            <div className={frame.foot}>
              <p className={frame.footNote}>{view.isNew ? 'Gruppen skapas när du sparar.' : 'Fastigheter du avmarkerar tas bara bort ur gruppen.'}</p>
              <div className={frame.actions}>
                <button className={frame.button} onClick={() => setView({ kind: 'list' })} disabled={busy}>Tillbaka</button>
                <button className={frame.primary} onClick={() => saveMembers(view)} disabled={busy}>
                  {busy ? 'Sparar…' : view.isNew ? `Skapa gruppen (${view.selected.length})` : `Spara (${view.selected.length})`}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <form className={styles.create} onSubmit={startCreate}>
              <label>
                Ny grupp
                <input value={newName} maxLength={PROPERTY_GROUP_NAME_MAX} onChange={(e) => setNewName(e.target.value)} placeholder="t.ex. Innerstad, Bolag AB eller Anna Svensson" />
              </label>
              <button className={frame.primary} disabled={busy || !newName.trim()}>Skapa grupp</button>
            </form>

            {options.length ? (
              <ul className={styles.list} aria-label="Grupper">
                {options.map((g) => (
                  <li key={g.id} className={styles.item}>
                    {renaming?.id === g.id ? (
                      <div className={styles.rename}>
                        <input aria-label={`Nytt namn för ${g.label}`} value={renaming.name} maxLength={PROPERTY_GROUP_NAME_MAX} autoFocus
                          onChange={(e) => setRenaming({ id: g.id, name: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); }} />
                        <button className={`${frame.primary} ${frame.small}`} onClick={saveRename} disabled={busy}>Spara</button>
                        <button className={`${frame.button} ${frame.small}`} onClick={() => setRenaming(null)} disabled={busy}>Avbryt</button>
                      </div>
                    ) : (
                      <>
                        <div className={styles.name}>
                          <strong>{g.label}</strong>
                          <span>{g.count} {g.count === 1 ? 'fastighet' : 'fastigheter'}</span>
                        </div>
                        <div className={styles.itemActions}>
                          <button className={`${frame.button} ${frame.small}`} disabled={busy}
                            onClick={() => setView({ kind: 'members', id: g.id, label: g.label, isNew: false, selected: portfolio.properties.filter((s) => s.property.groupIds.includes(g.id)).map((s) => s.property.id) })}>
                            Välj fastigheter
                          </button>
                          <button className={`${frame.button} ${frame.small}`} disabled={busy} onClick={() => { setConfirming(null); setRenaming({ id: g.id, name: g.label }); }}>Byt namn</button>
                          <button className={`${frame.button} ${frame.small} ${styles.danger}`} disabled={busy} onClick={() => { setBlocked(null); setRenaming(null); setConfirming(g.id); }} aria-label={`Ta bort ${g.label}`}>Ta bort</button>
                        </div>
                        {blocked?.id === g.id && <p className={styles.confirm} role="alert">{blocked.message}</p>}
                        {confirming === g.id && (
                          <p className={styles.confirm} role="alert">
                            Ta bort gruppen <b>{g.label}</b>? {g.count > 0 ? `De ${g.count} fastigheterna finns kvar, bara grupperingen försvinner.` : 'Gruppen är tom.'}{' '}
                            <button className={`${frame.primary} ${frame.small}`} onClick={() => remove(g.id)} disabled={busy}>Ta bort gruppen</button>{' '}
                            <button className={`${frame.button} ${frame.small}`} onClick={() => setConfirming(null)} disabled={busy}>Avbryt</button>
                          </p>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>Inga grupper ännu. Skriv ett namn ovan och välj gruppens fastigheter.</p>
            )}

            <div className={frame.foot}>
              <p className={frame.footNote}>Grupperna gäller alla i organisationen. En import med kolumnen &quot;Grupp&quot; lägger nya fastigheter direkt i sin grupp.</p>
              <div className={frame.actions}>
                <button className={frame.primary} onClick={onClose} disabled={busy}>Klar</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
