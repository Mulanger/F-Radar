import { expect, it } from 'vitest';
import { indexSmhiForecastGrid } from '../src/smhi/grid';

it('selects an official nearest grid point across bin boundaries and accounts for latitude', () => {
  const catalog = indexSmhiForecastGrid({ type: 'MultiPoint', coordinates: [[18.099, 59.3], [18.131, 59.303], [18.103, 59.319]] });
  expect(catalog?.nearest(59.301, 18.101)).toEqual({ lat: 59.3, lon: 18.099 });
  expect(catalog?.nearest(59.303, 18.128)).toEqual({ lat: 59.303, lon: 18.131 });
  expect(catalog?.nearest(55.5, 13)).toBeNull();
});

it('rejects a broken provider catalogue rather than inventing forecast locations', () => {
  expect(indexSmhiForecastGrid({ type: 'Point', coordinates: [18, 59] })).toBeNull();
  expect(indexSmhiForecastGrid({ type: 'MultiPoint', coordinates: [[18, 59], [200, 59]] })).toBeNull();
  expect(indexSmhiForecastGrid({ type: 'MultiPoint', coordinates: [] })).toBeNull();
});
