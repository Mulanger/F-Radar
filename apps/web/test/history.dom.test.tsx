// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEMO_REFERENCE_TIME } from '@fastighetsradar/domain/fixtures';
import { HistoryView } from '../components/properties/HistoryView';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
afterEach(() => cleanup());

describe('history export from the rendered view', () => {
  it('builds a UTF-8 CSV for the selected property when the download button is pressed', async () => {
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
    const create = vi.fn((_blob: Blob) => 'blob:history-export');
    URL.createObjectURL = create;
    URL.revokeObjectURL = vi.fn();
    let filename = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      filename = this.download;
    });
    render(
      <HistoryView propertyId="demo-augustendal-brygga" mode="demo" referenceTime={DEMO_REFERENCE_TIME} />,
    );
    const button = screen.getByRole('button', { name: '↓ Ladda ner som CSV' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    expect(create).toHaveBeenCalledOnce();
    expect(filename).toBe('fastighetsradar-historik-demo-augustendal-brygga-2024-11-12-2025-11-11.csv');
    const blob = create.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/csv;charset=utf-8');
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(csv).toContain('fastighet_id');
    expect(csv).toContain('demo-augustendal-brygga');
    expect(csv).toContain('Stockholm-Observatoriekullen A');
    expect(csv).toContain('SMHI-dygn kl 06–06 UTC');
  });
});
