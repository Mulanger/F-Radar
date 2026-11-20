'use client';

import { useClerk, useOrganization, useOrganizationList, useReverification, useUser } from '@clerk/nextjs';
import { isClerkAPIResponseError, isReverificationCancelledError } from '@clerk/nextjs/errors';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useDashboard } from '@/lib/state/dashboard-state';
import { IconChevronDown, IconLogOut, IconShield, IconUser } from '../ui/icons';
import { ProfilePage, ProfileRow, RowContent } from './ProfilePage';
import s from './ProfilePage.module.css';

export function LiveProfile() {
  const { user } = useUser();
  const { organization, membership } = useOrganization();
  const { portfolio } = useDashboard();
  const role = portfolio.viewer.role;
  const roleName = role === 'org:admin' ? 'Administratör' : role === 'org:member' ? 'Medlem' : membership?.roleName || role;

  return <ProfilePage
    name={user?.fullName || portfolio.viewer.displayName}
    email={user ? user.primaryEmailAddress?.emailAddress ?? 'Ingen primär e-postadress registrerad' : undefined}
    organization={organization?.name}
    role={roleName}
    access={role === 'org:admin' ? 'Kan ändra SMS-regler och bevakningsinställningar' : 'Läsbehörighet för SMS-regler och bevakningsinställningar'}
    account={user ? <AccountSettings key={user.id} user={user} /> : <ProfileRow icon={<IconUser />} title="Laddar kontouppgifter…" />}
    organizationActions={<OrganizationPicker activeId={organization?.id} />}
    signOut={<SignOut />}
  />;
}

type Account = NonNullable<ReturnType<typeof useUser>['user']>;
type Editor = 'name' | 'password';
type SaveState = 'idle' | 'saving' | 'saved';

function AccountSettings({ user }: { user: Account }) {
  const router = useRouter();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const updatePassword = useReverification((currentPassword: string, newPassword: string) =>
    user.updatePassword({ currentPassword, newPassword }),
  );

  function toggle(next: Editor) {
    setError('');
    setState('idle');
    setEditor(editor === next ? null : next);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'saving') return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const firstName = String(fields.get('given-name') ?? '').trim();
    const lastName = String(fields.get('family-name') ?? '').trim();
    const currentPassword = String(fields.get('current-password') ?? '');
    const newPassword = String(fields.get('new-password') ?? '');
    setError('');
    if (editor === 'name' && !firstName && !lastName) {
      setError('Fyll i ett förnamn eller efternamn.');
      return;
    }
    if (editor === 'password' && newPassword !== fields.get('confirm-password')) {
      setError('De nya lösenorden stämmer inte överens.');
      return;
    }
    setState('saving');
    try {
      if (editor === 'name') {
        await user.update({ firstName: firstName || null, lastName: lastName || null });
        router.refresh();
      } else if (editor === 'password') {
        await updatePassword(currentPassword, newPassword);
        form.reset();
      }
      setState('saved');
    } catch (cause) {
      setState('idle');
      setError(accountError(cause, editor));
    }
  }

  const feedback = <>
    {error && <p role="alert" className={s.error}>{error}</p>}
    {state === 'saved' && <p role="status" className={s.success}>{editor === 'name' ? 'Namnet sparades.' : 'Lösenordet ändrades.'}</p>}
    <button type="submit" className={s.primary} disabled={state === 'saving'}>{state === 'saving' ? 'Sparar…' : 'Spara'}</button>
  </>;

  return <>
    <AccountAction icon={<IconUser />} title="Ändra namn" open={editor === 'name'}
      disabled={state === 'saving'} onClick={() => toggle('name')}>
      <form className={s.form} onSubmit={save}>
        <fieldset disabled={state === 'saving'} className={s.fields}>
          <label>Förnamn<input name="given-name" autoComplete="given-name" defaultValue={user.firstName ?? ''} /></label>
          <label>Efternamn<input name="family-name" autoComplete="family-name" defaultValue={user.lastName ?? ''} /></label>
        </fieldset>
        {feedback}
      </form>
    </AccountAction>
    {user.passwordEnabled && <AccountAction icon={<IconShield />} title="Ändra lösenord" open={editor === 'password'}
      disabled={state === 'saving'} onClick={() => toggle('password')}>
      <form className={s.form} onSubmit={save}>
        <fieldset disabled={state === 'saving'} className={s.fields}>
          <label>Nuvarande lösenord<input name="current-password" type="password" autoComplete="current-password" required /></label>
          <label>Nytt lösenord<input name="new-password" type="password" autoComplete="new-password" required /></label>
          <label>Bekräfta nytt lösenord<input name="confirm-password" type="password" autoComplete="new-password" required /></label>
        </fieldset>
        {feedback}
      </form>
    </AccountAction>}
  </>;
}

function AccountAction({ icon, title, open, disabled, onClick, children }: {
  icon: ReactNode; title: string; open: boolean; disabled: boolean; onClick: () => void; children: ReactNode;
}) {
  return <div>
    <button type="button" className={s.row} onClick={onClick} aria-expanded={open} disabled={disabled}>
      <RowContent icon={icon} title={title} />
      <IconChevronDown className={s.chevron} size={16} />
    </button>
    {open && children}
  </div>;
}

function accountError(cause: unknown, editor: Editor | null) {
  if (isReverificationCancelledError(cause)) return 'Verifieringen avbröts. Försök igen när du är redo.';
  const code = isClerkAPIResponseError(cause) ? cause.errors[0]?.code : undefined;
  switch (code) {
    case 'form_password_incorrect': return 'Kontrollera ditt nuvarande lösenord.';
    case 'form_password_pwned': return 'Välj ett lösenord som inte har förekommit i en dataläcka.';
    case 'form_password_length_too_short': return 'Välj ett längre lösenord.';
  }
  return editor === 'name'
    ? 'Namnet kunde inte sparas. Kontrollera uppgifterna och försök igen.'
    : 'Lösenordet kunde inte ändras. Kontrollera uppgifterna och försök igen.';
}

function OrganizationPicker({ activeId }: { activeId?: string }) {
  const { setActive, userMemberships } = useOrganizationList({ userMemberships: { infinite: true } });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const alternatives = userMemberships.data?.filter(item => item.organization.id !== activeId) ?? [];
  if (!activeId || (!alternatives.length && !userMemberships.hasNextPage)) return null;

  async function switchOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setActive || pending) return;
    const id = new FormData(event.currentTarget).get('organization');
    if (typeof id !== 'string' || !alternatives.some(item => item.organization.id === id)) return;
    setError('');
    setPending(true);
    try {
      await setActive({
        organization: id,
        navigate: async ({ decorateUrl }) => {
          // Reload the portfolio and App Router caches using the newly selected session context.
          window.location.assign(decorateUrl('/profile'));
        },
      });
    } catch {
      setPending(false);
      setError('Organisationen kunde inte bytas. Försök igen.');
    }
  }

  return <form className={s.form} onSubmit={switchOrganization}>
    <label>Byt organisation
      <select name="organization" defaultValue="" required disabled={pending || !setActive}>
        <option value="" disabled>Välj organisation</option>
        {alternatives.map(({ id, organization }) => <option key={id} value={organization.id}>{organization.name}</option>)}
      </select>
    </label>
    {error && <p role="alert" className={s.error}>{error}</p>}
    <div className={s.formActions}>
      <button type="submit" className={s.primary} disabled={pending || !setActive}>{pending ? 'Byter…' : 'Byt organisation'}</button>
      {userMemberships.hasNextPage && <button type="button" className={s.secondary}
        disabled={pending || userMemberships.isFetching} onClick={() => userMemberships.fetchNext()}>
        {userMemberships.isFetching ? 'Laddar…' : 'Visa fler'}
      </button>}
    </div>
  </form>;
}

function SignOut() {
  const { signOut } = useClerk();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function handleSignOut() {
    setError(false);
    setPending(true);
    try {
      await signOut({ redirectUrl: '/' });
    } catch {
      setError(true);
      setPending(false);
    }
  }
  return <div className={s.card}>
    <button type="button" className={`${s.row} ${s.signOut}`} onClick={handleSignOut} disabled={pending}>
      <RowContent icon={<IconLogOut />} title={pending ? 'Loggar ut…' : 'Logga ut'} />
    </button>
    {error && <p role="alert" className={`${s.error} ${s.signOutError}`}>Utloggningen misslyckades. Försök igen.</p>}
  </div>;
}
