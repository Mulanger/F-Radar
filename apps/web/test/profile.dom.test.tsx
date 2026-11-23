// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiveProfile } from '@/components/profile/LiveProfile';
import { DemoProfile } from '@/components/profile/ProfilePage';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  updatePassword: vi.fn(),
  signOut: vi.fn(),
  setActive: vi.fn(),
  refresh: vi.fn(),
  mode: 'live',
  role: 'org:member',
  passwordEnabled: true,
  multipleOrganizations: false,
}));

vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({
    user: {
      id: 'user-1',
      fullName: 'Elin Lindqvist',
      firstName: 'Elin',
      lastName: 'Lindqvist',
      primaryEmailAddress: { emailAddress: 'elin@example.com' },
      passwordEnabled: mocks.passwordEnabled,
      update: mocks.update,
      updatePassword: mocks.updatePassword,
    },
  }),
  useOrganization: () => ({ organization: { id: 'org-1', name: 'Fastighetsgruppen' } }),
  useOrganizationList: () => ({
    setActive: mocks.setActive,
    userMemberships: {
      data: [
        { id: 'membership-1', organization: { id: 'org-1', name: 'Fastighetsgruppen' } },
        ...(mocks.multipleOrganizations ? [{ id: 'membership-2', organization: { id: 'org-2', name: 'Östra Förvaltning' } }] : []),
      ],
    },
  }),
  useReverification: (request: unknown) => request,
  useClerk: () => ({ signOut: mocks.signOut }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/lib/state/dashboard-state', () => ({
  useDashboard: () => ({
    mode: mocks.mode,
    basePath: mocks.mode === 'demo' ? '/demo' : '',
    portfolio: { ...demoPortfolio, viewer: { ...demoPortfolio.viewer, role: mocks.role } },
  }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode = 'live';
  mocks.role = 'org:member';
  mocks.passwordEnabled = true;
  mocks.multipleOrganizations = false;
});
afterEach(cleanup);

it('shows account and organization data and keeps the existing monitoring routes', () => {
  mocks.passwordEnabled = false;
  render(<LiveProfile />);
  expect(screen.getByText('elin@example.com')).toBeTruthy();
  expect(screen.getByText('Fastighetsgruppen')).toBeTruthy();
  expect(screen.getByText('Läsbehörighet för SMS-regler och bevakningsinställningar')).toBeTruthy();
  expect(screen.getByRole('link', { name: /^SMS-regler och mottagare/ }).getAttribute('href')).toBe('/sms-rules?via=profile');
  expect(screen.getByRole('link', { name: /^Kvitteringar/ }).getAttribute('href')).toBe('/acknowledgements?via=profile');
  expect(screen.getByRole('link', { name: /^Bevakningsinställningar/ }).getAttribute('href')).toBe('/settings?via=profile');
  expect(screen.queryByRole('button', { name: 'Ändra lösenord' })).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
});

it('saves the name and refreshes the server-rendered account data', async () => {
  render(<LiveProfile />);
  fireEvent.click(screen.getByRole('button', { name: 'Ändra namn' }));
  fireEvent.change(screen.getByLabelText('Förnamn'), { target: { value: '  Anna ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Spara' }));
  expect(await screen.findByText('Namnet sparades.')).toBeTruthy();
  expect(mocks.update).toHaveBeenCalledWith({ firstName: 'Anna', lastName: 'Lindqvist' });
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it('checks password confirmation before requesting a change and clears the fields after saving', async () => {
  render(<LiveProfile />);
  fireEvent.click(screen.getByRole('button', { name: 'Ändra lösenord' }));
  fireEvent.change(screen.getByLabelText('Nuvarande lösenord'), { target: { value: 'old-password' } });
  fireEvent.change(screen.getByLabelText('Nytt lösenord', { exact: true }), { target: { value: 'new-password' } });
  const confirm = screen.getByLabelText<HTMLInputElement>('Bekräfta nytt lösenord');
  fireEvent.change(confirm, { target: { value: 'different-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Spara' }));
  expect(screen.getByRole('alert').textContent).toBe('De nya lösenorden stämmer inte överens.');
  expect(mocks.updatePassword).not.toHaveBeenCalled();
  fireEvent.change(confirm, { target: { value: 'new-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Spara' }));
  expect(await screen.findByText('Lösenordet ändrades.')).toBeTruthy();
  expect(mocks.updatePassword).toHaveBeenCalledWith({ currentPassword: 'old-password', newPassword: 'new-password' });
  expect(confirm.value).toBe('');
});

it('offers the user’s other organizations and signs out through Clerk', async () => {
  mocks.multipleOrganizations = true;
  mocks.role = 'org:admin';
  mocks.setActive.mockRejectedValueOnce(new Error('Unavailable'));
  render(<LiveProfile />);
  const picker = within(screen.getByRole('region', { name: 'Organisation' }));
  expect(picker.getByText('Administratör')).toBeTruthy();
  expect(picker.queryByRole('option', { name: 'Fastighetsgruppen' })).toBeNull();
  fireEvent.change(picker.getByRole('combobox'), { target: { value: 'org-2' } });
  fireEvent.click(picker.getByRole('button', { name: 'Byt organisation' }));
  expect(await picker.findByRole('alert')).toBeTruthy();
  expect(mocks.setActive).toHaveBeenCalledWith({ organization: 'org-2', navigate: expect.any(Function) });
  fireEvent.click(screen.getByRole('button', { name: 'Logga ut' }));
  await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ redirectUrl: '/' }));
});

it('keeps demo navigation in the demo and disables live account actions', () => {
  mocks.mode = 'demo';
  render(<DemoProfile />);
  expect(screen.getByRole('link', { name: /^Kvitteringar/ }).getAttribute('href')).toBe('/demo/acknowledgements?via=profile');
  expect(screen.getByRole('link', { name: /^SMS-regler/ }).getAttribute('href')).toBe('/demo/sms-rules?via=profile');
  expect(screen.queryByRole('button', { name: 'Ändra namn' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Logga ut' })).toBeNull();
});
