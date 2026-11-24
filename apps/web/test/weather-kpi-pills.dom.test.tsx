// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { WxSplit } from '@/lib/view-models/overview';
import { WeatherKpiPills } from '@/components/dashboard/WeatherKpiPills';

const openProperty = vi.fn();
vi.mock('@/lib/state/dashboard-state', () => ({ useDashboard: () => ({ openProperty }) }));
afterEach(cleanup);

const items = Array.from({ length: 7 }, (_, i) => ({ propertyId: `p${i}`, name: `Fastighet ${i + 1}`, text: `Väntar ${30 - i} mm regn kommande 24 h` }));
const split: WxSplit[] = [
  { label: 'Regn', n: 7, title: 'Kraftigt regn', rule: 'Minst 15 mm', items },
  { label: 'Vind', n: 0, title: 'Hård vind', rule: 'Byvind minst 15 m/s', items: [] },
];

describe('weather KPI pills', () => {
  it('opens affected properties when one warning covers several addresses', () => {
    render(<WeatherKpiPills available split={[{ label: 'Gul', title: 'Gul varning', warningLevel: 'Yellow', n: 1, rule: '', items }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gul: 1 varning. Visa vilka' }));
    const card = screen.getByRole('dialog', { name: 'Gul varning: fastigheter' });
    expect(within(card).getByText('7 fastigheter')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: /Fastighet 1/ }));
    expect(openProperty).toHaveBeenCalledWith('p0');
  });

  it('keeps the card open while scrolling its properties and can open the larger list', () => {
    render(<WeatherKpiPills split={split} available />);
    expect((screen.getByRole('button', { name: /^Vind: 0/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Regn: 7 fastigheter. Visa vilka' }));
    const card = screen.getByRole('dialog', { name: 'Kraftigt regn: fastigheter' });
    expect(within(card).getAllByRole('button', { name: /^Fastighet/ })).toHaveLength(7);
    fireEvent.scroll(within(card).getByRole('list').parentElement!);
    expect(screen.getByRole('dialog')).toBe(card);
    fireEvent.click(within(card).getByRole('button', { name: 'Visa alla 7' }));
    const modal = screen.getByRole('dialog', { name: /Kraftigt regn · 7 fastigheter/ });
    expect(within(modal).getAllByRole('button', { name: /^Fastighet/ })).toHaveLength(7);
    fireEvent.click(within(modal).getByRole('button', { name: /Fastighet 7/ }));
    expect(openProperty).toHaveBeenCalledWith('p6');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is not clickable while the forecast is unavailable', () => {
    render(<WeatherKpiPills split={split} available={false} />);
    expect((screen.getByRole('button', { name: 'Regn: prognos saknas' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
