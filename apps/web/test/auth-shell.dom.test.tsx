// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/sign-in' }));
vi.mock('@/components/auth/AuthScene', () => ({ AuthScene: () => <div data-testid="scene" /> }));

import { AuthShell } from '@/components/auth/AuthShell';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AuthShell', () => {
  it('offers a way back to the start page from both the desktop header and the mobile scene', () => {
    render(<AuthShell><p>form</p></AuthShell>);
    const back = screen.getAllByRole('link', { name: 'Till startsidan' });
    expect(back).toHaveLength(2);
    for (const link of back) expect(link.getAttribute('href')).toBe('/');
    // The mobile arrow sits in the scene panel, next to the mobile brand.
    const panel = screen.getByTestId('scene').parentElement!;
    expect(within(panel).getByRole('link', { name: 'Till startsidan' })).toBeTruthy();
  });
});
