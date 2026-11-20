// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const createOrganization = vi.fn();
const setActive = vi.fn();
const signOut = vi.fn();
let memberships: unknown[] = [];

vi.mock('@clerk/nextjs', () => ({
  useClerk: () => ({ signOut }),
  useOrganizationList: () => ({
    isLoaded: true,
    createOrganization,
    setActive,
    userMemberships: { data: memberships, isLoading: false },
  }),
}));

import { OnboardingForm } from '@/components/auth/OnboardingForm';

beforeEach(() => {
  vi.clearAllMocks();
  memberships = [];
  setActive.mockImplementation(async ({ navigate }) => {
    await navigate({ session: { currentTask: undefined }, decorateUrl: (u: string) => u });
  });
});
afterEach(cleanup);

describe('OnboardingForm (step 2 – company name)', () => {
  it('only asks for the company name – no invitations or organization lists', () => {
    render(<OnboardingForm email="elin@foretag.se" />);
    expect(screen.getByRole('heading', { name: 'Vad heter ditt företag?' })).toBeTruthy();
    expect(screen.getByLabelText('Företagsnamn')).toBeTruthy();
    expect(screen.queryByText(/Inbjud/)).toBeNull();
    expect(screen.queryByRole('list', { name: /organisationer/i })).toBeNull();
    expect(screen.getByText('elin@foretag.se')).toBeTruthy();
  });

  it('requires a name', () => {
    render(<OnboardingForm />);
    fireEvent.click(screen.getByRole('button', { name: /Kom igång/ }));
    expect(screen.getByText('Ange företagets namn.')).toBeTruthy();
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it('creates the organization from the company name and opens the overview', async () => {
    createOrganization.mockResolvedValue({ id: 'org_1' });
    render(<OnboardingForm />);
    fireEvent.change(screen.getByLabelText('Företagsnamn'), { target: { value: '  Lindqvist Fastigheter AB ' } });
    fireEvent.click(screen.getByRole('button', { name: /Kom igång/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/overview'));
    expect(createOrganization).toHaveBeenCalledWith({ name: 'Lindqvist Fastigheter AB' });
    expect(setActive).toHaveBeenCalledWith(expect.objectContaining({ organization: 'org_1' }));
  });

  it('reopens an existing company instead of creating a second one', async () => {
    memberships = [{ organization: { id: 'org_2', name: 'Lindqvist Fastigheter AB' } }];
    render(<OnboardingForm />);
    await waitFor(() => expect(setActive).toHaveBeenCalledWith(expect.objectContaining({ organization: 'org_2' })));
    expect(createOrganization).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/overview');
  });

  it('shows Clerk errors in Swedish', async () => {
    createOrganization.mockRejectedValue({ errors: [{ code: 'form_param_max_length_exceeded', message: 'too long', meta: { paramName: 'name' } }] });
    render(<OnboardingForm />);
    fireEvent.change(screen.getByLabelText('Företagsnamn'), { target: { value: 'x'.repeat(200) } });
    fireEvent.click(screen.getByRole('button', { name: /Kom igång/ }));
    expect(await screen.findByText('Namnet är för långt.')).toBeTruthy();
    expect(setActive).not.toHaveBeenCalled();
  });
});
