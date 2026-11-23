// @vitest-environment jsdom
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import type { FeedItem, Portfolio } from '@fastighetsradar/domain';
import { DashboardStateProvider } from '@/lib/state/dashboard-state';
import { MobileAlerts } from '@/components/mobile/MobileAlerts';
import { MobileNavigation } from '@/components/mobile/MobileNavigation';
import { GroupFilter } from '@/components/groups/GroupFilter';
import { GroupChips } from '@/components/groups/GroupChips';
import { PropertyGroupsDialog } from '@/components/groups/PropertyGroupsDialog';
import { applyGroupChange, runGroupChange } from '@/lib/groups/store';
import { filterByGroup, groupOptions } from '@/lib/view-models/groups';
import { buildPreview, detectColumns, importRows, parseImportText } from '@/lib/import/parse';

/** Property groups in the web app (docs/plans/skalning.md, Fas 4 / S-20). */

const nav = vi.hoisted(() => ({ pathname: '/overview', router: { refresh: vi.fn(), push: vi.fn() } }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => nav.router, useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} /> }));
vi.mock('@/lib/design/use-mobile-dashboard', () => ({ useAndroidNavigation: () => false, useMobileDashboard: () => false }));

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  nav.pathname = '/overview';
  nav.router.refresh.mockClear();
});

const inner = demoPortfolio.properties.filter((s) => s.property.groupIds.includes('inner'));
const outer = demoPortfolio.properties.filter((s) => s.property.groupIds.includes('outer'));

describe('group view model', () => {
  it('counts and filters a property in several groups in each of them', () => {
    const both = applyGroupChange(demoPortfolio, { kind: 'create', id: 'g-anna', name: 'Anna', propertyIds: [inner[0]!.property.id, outer[0]!.property.id] });
    expect(groupOptions(both).map((g) => [g.label, g.count])).toEqual([
      ['Alla fastigheter', demoPortfolio.properties.length],
      ['Anna', 2],
      ['Förort & Kust', outer.length],
      ['Innerstad', inner.length],
    ]);
    expect(filterByGroup(both, 'g-anna').map((s) => s.property.id)).toEqual([inner[0]!.property.id, outer[0]!.property.id].sort((a, b) =>
      demoPortfolio.properties.findIndex((s) => s.property.id === a) - demoPortfolio.properties.findIndex((s) => s.property.id === b)));
    expect(filterByGroup(both, 'inner')).toHaveLength(inner.length);

    const renamed = applyGroupChange(both, { kind: 'rename', id: 'g-anna', name: 'Bo' });
    expect(renamed.groups.map((g) => g.label)).toEqual(['Bo', 'Förort & Kust', 'Innerstad']);
    const moved = applyGroupChange(renamed, { kind: 'members', id: 'g-anna', propertyIds: [outer[1]!.property.id] });
    expect(filterByGroup(moved, 'g-anna').map((s) => s.property.id)).toEqual([outer[1]!.property.id]);
    expect(moved.properties.find((s) => s.property.id === outer[1]!.property.id)!.property.groupIds).toEqual(['outer', 'g-anna']);
    const removed = applyGroupChange(moved, { kind: 'remove', id: 'g-anna' });
    expect(removed.groups.map((g) => g.id)).toEqual(['outer', 'inner']);
    expect(removed.properties.every((s) => !s.property.groupIds.includes('g-anna'))).toBe(true);
  });

  it('runs a live change through the API, then shows it at once and reloads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ group: { id: 'srv-1', name: 'Kusten', propertyCount: 1 } }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const patch = vi.fn();
    const refresh = vi.fn();
    const id = await runGroupChange({ kind: 'create', name: ' Kusten ', propertyIds: [outer[0]!.property.id] }, { live: true, portfolio: () => demoPortfolio, patch, refresh });
    expect(id).toBe('srv-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/app/property-groups', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Kusten', propertyIds: [outer[0]!.property.id] }) }));
    expect((patch.mock.calls[0]![0] as Portfolio).groups.some((g) => g.id === 'srv-1' && g.label === 'Kusten')).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(Response.json({ type: 'urn:fastighetsradar:problem:group-limit', status: 409 }, { status: 409 }));
    await expect(runGroupChange({ kind: 'create', name: 'X', propertyIds: [] }, { live: true, portfolio: () => demoPortfolio, patch, refresh })).rejects.toThrow('högst 100 grupper');
    fetchMock.mockResolvedValueOnce(Response.json({ type: 'urn:fastighetsradar:problem:group-name-taken', status: 409 }, { status: 409 }));
    await expect(runGroupChange({ kind: 'rename', id: 'srv-1', name: 'Innerstad' }, { live: true, portfolio: () => demoPortfolio, patch, refresh })).rejects.toThrow('Det finns redan en grupp');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await runGroupChange({ kind: 'members', id: 'srv-1', propertyIds: ['a', 'b'] }, { live: true, portfolio: () => demoPortfolio, patch, refresh });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/app/property-groups/srv-1/properties', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ propertyIds: ['a', 'b'] }) }));
  });
});

describe('import with a group column', () => {
  it('reads "Grupp" from the header and refuses a group name over 60 characters', () => {
    const table = parseImportText(`Namn;Adress;Ort;Grupp\nHuset;Storgatan 1;Uppsala;Innerstad\nAnnat;Lillgatan 2;Uppsala;\nLångt;Torget 3;Uppsala;${'x'.repeat(61)}`);
    const roles = detectColumns(table);
    expect(roles).toEqual(['name', 'address', 'city', 'group']);
    const preview = buildPreview(table, roles, []);
    expect(preview.map((p) => [p.status, p.group ?? null])).toEqual([['ready', 'Innerstad'], ['ready', null], ['invalid', 'x'.repeat(61)]]);
    expect(preview[2]!.message).toBe('Gruppnamnet är längre än 60 tecken');
    expect(importRows(preview)).toEqual([
      { row: 2, name: 'Huset', address: 'Storgatan 1, Uppsala', group: 'Innerstad' },
      { row: 3, name: 'Annat', address: 'Lillgatan 2, Uppsala' },
    ]);
  });
});

describe('group components', () => {
  function dashboard(children: React.ReactNode, portfolio: Portfolio = demoPortfolio) {
    return <DashboardStateProvider mode="demo" basePath="/demo" portfolio={portfolio}>{children}</DashboardStateProvider>;
  }

  it('shows tabs while the groups fit and a menu beyond, and keeps the choice for the session', () => {
    render(dashboard(<GroupFilter variant="auto" />));
    const tabs = screen.getByRole('tablist', { name: 'Fastighetsgrupp' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual([`Alla fastigheter${demoPortfolio.properties.length}`, `Innerstad${inner.length}`, `Förort & Kust${outer.length}`]);
    fireEvent.click(within(tabs).getByRole('tab', { name: /Innerstad/ }));
    expect(within(tabs).getByRole('tab', { name: /Innerstad/ }).getAttribute('aria-selected')).toBe('true');
    expect(sessionStorage.getItem(`fr-view:/demo:${demoPortfolio.organizationId}:group`)).toBe('"inner"');
    cleanup();

    // Seven groups: a menu, which starts on the remembered group.
    let many = demoPortfolio;
    for (let i = 1; i <= 5; i++) many = applyGroupChange(many, { kind: 'create', id: `g${i}`, name: `Område ${i}`, propertyIds: [] });
    render(dashboard(<GroupFilter variant="auto" />, many));
    const select = screen.getByRole('combobox', { name: /Grupp/ }) as HTMLSelectElement;
    expect(select.value).toBe('inner');
    expect(select.options).toHaveLength(8);
    cleanup();

    // No groups: the menu is not shown at all.
    render(dashboard(<GroupFilter />, { ...demoPortfolio, groups: [] }));
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('creates a group and picks 2 of its properties by search in the group dialog', async () => {
    const change = vi.fn().mockResolvedValue('g-new');
    const onClose = vi.fn();
    render(<PropertyGroupsDialog portfolio={demoPortfolio} demo change={change} onClose={onClose} />);
    expect(screen.getByText(/Demoläge: grupperna sparas inte/)).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Grupper' }).children).toHaveLength(2);

    const name = screen.getByRole('textbox', { name: 'Ny grupp' });
    fireEvent.change(name, { target: { value: 'innerstad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skapa grupp' }));
    expect(screen.getByRole('alert').textContent).toBe('Det finns redan en grupp med det namnet.');

    fireEvent.change(name, { target: { value: 'Kajerna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skapa grupp' }));
    expect(screen.getByRole('heading', { name: 'Ny grupp: Kajerna' })).toBeTruthy();
    const kaj = demoPortfolio.properties.filter((s) => /kaj/i.test(`${s.property.name} ${s.property.address}`));
    expect(kaj.length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Sök fastighet för Kajerna' }), { target: { value: 'kaj' } });
    fireEvent.click(screen.getByRole('button', { name: `Markera alla som syns (${kaj.length})` }));
    fireEvent.click(screen.getByRole('button', { name: `Skapa gruppen (${kaj.length})` }));
    await waitFor(() => expect(change).toHaveBeenCalledWith({ kind: 'create', name: 'Kajerna', propertyIds: kaj.map((s) => s.property.id) }));
    expect(await screen.findByText(`Kajerna: ${kaj.length} ${kaj.length === 1 ? 'fastighet' : 'fastigheter'} sparade.`)).toBeTruthy();
  });

  it('renames, deletes after a confirmation, and replaces the members of a group', async () => {
    const change = vi.fn().mockResolvedValue('inner');
    render(<PropertyGroupsDialog portfolio={demoPortfolio} demo={false} change={change} onClose={() => {}} />);
    const row = screen.getByText('Innerstad').closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Byt namn' }));
    fireEvent.change(within(row).getByRole('textbox', { name: 'Nytt namn för Innerstad' }), { target: { value: 'City' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Spara' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith({ kind: 'rename', id: 'inner', name: 'City' }));

    fireEvent.click(within(row).getByRole('button', { name: 'Ta bort Innerstad' }));
    expect(within(row).getByRole('alert').textContent).toContain(`De ${inner.length} fastigheterna finns kvar`);
    fireEvent.click(within(row).getByRole('button', { name: 'Ta bort gruppen' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith({ kind: 'remove', id: 'inner' }));

    fireEvent.click(within(screen.getByText('Förort & Kust').closest('li')!).getByRole('button', { name: 'Välj fastigheter' }));
    expect(screen.getByRole('status').textContent).toBe(`${outer.length} av ${demoPortfolio.properties.length} valda`);
    fireEvent.click(screen.getByRole('button', { name: 'Avmarkera alla' }));
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(inner[0]!.property.name) }));
    fireEvent.click(screen.getByRole('button', { name: 'Spara (1)' }));
    await waitFor(() => expect(change).toHaveBeenLastCalledWith({ kind: 'members', id: 'outer', propertyIds: [inner[0]!.property.id] }));
  });

  it('toggles a property\'s groups and creates a new one from the property dialog', async () => {
    const onChange = vi.fn();
    const onCreate = vi.fn().mockResolvedValue('g-ny');
    render(<GroupChips groups={demoPortfolio.groups} selected={['inner']} onChange={onChange} onCreate={onCreate} />);
    expect(screen.getByRole('button', { name: 'Innerstad' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Förort & Kust' }));
    expect(onChange).toHaveBeenLastCalledWith(['inner', 'outer']);
    // An existing name in another case is chosen, not created again.
    fireEvent.change(screen.getByRole('textbox', { name: 'Namn på ny grupp' }), { target: { value: 'förort & kust' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lägg till' }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(['inner', 'outer']);
    fireEvent.change(screen.getByRole('textbox', { name: 'Namn på ny grupp' }), { target: { value: 'Bolag AB' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lägg till' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(['inner', 'g-ny']));
    expect(onCreate).toHaveBeenCalledWith('Bolag AB');
  });
});

describe('alert feed for one group', () => {
  const alarm = (id: string, propertyId: string, title: string): FeedItem => ({
    id: `chg-${id}`, eventId: `event-${id}`, propertyId,
    publishedAt: demoPortfolio.generatedAt, sourceLabel: 'SMHI', sourceId: 'smhi_warnings', severity: 'warning',
    title, origin: 'live', ackRequired: true, unreadAlarmId: `chg-${id}`,
  });

  it('shows the group\'s alarms, says how many it leaves out, and marks only those it shows as read', async () => {
    const post = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', post);
    sessionStorage.setItem(`fr-view::${demoPortfolio.organizationId}:group`, '"inner"');
    const portfolio: Portfolio = { ...demoPortfolio, feed: [], activeAlarms: [alarm('1', inner[0]!.property.id, 'Kraftig vind i city'), alarm('2', outer[0]!.property.id, 'Höga flöden vid kusten')] };
    nav.pathname = '/alerts';
    render(<DashboardStateProvider mode="live" basePath="" portfolio={portfolio}><MobileNavigation /><MobileAlerts /></DashboardStateProvider>);

    expect(screen.getByRole('button', { name: 'Kvittera: Kraftig vind i city' })).toBeTruthy();
    expect(screen.queryByText('Höga flöden vid kusten')).toBeNull();
    expect(screen.getByText(/Visar bara/).textContent).toContain('1 händelse i andra fastigheter visas inte.');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/app/feed/alarm-reads', expect.objectContaining({ body: JSON.stringify({ changeIds: ['chg-1'] }) })));
    // The alarm in the other group stays unread and keeps the badge.
    await waitFor(() => expect(screen.getByLabelText('1 olästa larm')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Visa alla fastigheter' }));
    expect(screen.getByText('Höga flöden vid kusten')).toBeTruthy();
    expect(screen.queryByText(/Visar bara/)).toBeNull();
  });
});
