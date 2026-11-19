// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { buildUtilityCoverageReport, type PropertyUtilityStatus } from '@fastighetsradar/domain';
import { UtilityCoverage } from '../components/dashboard/UtilityCoverage';

afterEach(cleanup);
describe('coverage disclosure', () => {
  it('shows missing suppliers and approximate property links without claiming no outages', () => {
    const status: PropertyUtilityStatus = { utility: 'electricity', coverage: 'stale', operator: { id: 'test', name: 'Testnät', mapUrl: null }, updatedAt: null, current: [], upcoming: [], nearby: [], recentlyRestored: [] };
    const report = buildUtilityCoverageReport([{ id: 'p', geocodePrecision: 'street', positionSource: 'geocoded', statuses: [status] }], 'electricity');
    render(<UtilityCoverage reports={[report]} properties={[{ id: 'p', name: 'Testfastighet' }]} basePath="" />);
    expect(screen.getByText('El bevakas för 0 av 1 adresser')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Testfastighet', hidden: true }).getAttribute('href')).toBe('/properties/p');
    expect(screen.getByText(/Testnät: 1 adresser/)).toBeTruthy();
    expect(screen.queryByText(/Inga registrerade/)).toBeNull();
  });
});
