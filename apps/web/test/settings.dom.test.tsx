// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SAVE_DELAY_MS, SettingsPage } from '@/components/settings/SettingsPage';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const slider = () => screen.getByRole('slider', { name: 'Avstånd för Trafikverkets händelser' }) as HTMLInputElement;

describe('<SettingsPage /> – Trafikverket distance', () => {
  it('shows 500 m as the standard and saves once after dragging stops', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ ...JSON.parse(String(init!.body)), canEdit: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsPage initial={{ trafficRadiusM: 500, canEdit: true }} />);
    expect(slider()).toMatchObject({ min: '100', max: '3000', step: '100', value: '500' });
    expect(screen.getByText('Standard')).toBeTruthy();

    fireEvent.change(slider(), { target: { value: '1200' } });
    fireEvent.change(slider(), { target: { value: '1500' } });
    expect(screen.getAllByText('1,5 km').length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/app/settings');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ trafficRadiusM: 1500 }) });
    expect(screen.getByText('Sparat · gäller direkt')).toBeTruthy();
    expect(refresh).toHaveBeenCalled();

    // Back to the default with one click.
    fireEvent.click(screen.getByRole('button', { name: 'Återställ till 500 m' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ body: JSON.stringify({ trafficRadiusM: 500 }) });
  });

  it('reverts and explains when saving fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ title: 'Endast organisationsadministratörer får ändra inställningar' }), { status: 403 })));
    render(<SettingsPage initial={{ trafficRadiusM: 800, canEdit: true }} />);
    fireEvent.change(slider(), { target: { value: '2000' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });
    expect(slider().value).toBe('800');
    expect(screen.getByText('Endast organisationsadministratörer får ändra inställningar')).toBeTruthy();
  });

  it('is read-only for members who are not admins', () => {
    render(<SettingsPage initial={{ trafficRadiusM: 500, canEdit: false }} />);
    expect(slider().disabled).toBe(true);
    expect(screen.getByText(/läsbehörighet/)).toBeTruthy();
  });
});
