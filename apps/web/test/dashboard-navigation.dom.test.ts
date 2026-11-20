// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import {
  canReturnThroughHistory, completeDashboardArrival, dashboardSection, propertyHref,
  propertySmsHref, recordDashboardDeparture,
} from '@/lib/navigation/dashboard';

afterEach(() => {
  history.replaceState(null, '', '/');
  window.dispatchEvent(new PopStateEvent('popstate'));
});

it('uses the previous entry only when its destination and source match', () => {
  const detail = propertyHref('/demo', 'demo-1', 'properties');
  history.replaceState(null, '', '/demo/properties');
  recordDashboardDeparture(detail);
  history.pushState({ existing: true }, '', detail);
  completeDashboardArrival();

  expect(canReturnThroughHistory('/demo/properties')).toBe(true);
  expect(canReturnThroughHistory('/demo/overview')).toBe(false);
  expect(history.state.existing).toBe(true);
  history.pushState(null, '', detail);
  expect(canReturnThroughHistory('/demo/properties')).toBe(false);
});

it('keeps the original return when switching to another property in place', () => {
  const first = propertyHref('', 'first', 'overview');
  const second = propertyHref('', 'second', 'overview');
  history.replaceState(null, '', '/overview');
  recordDashboardDeparture(first);
  history.pushState(null, '', first);
  completeDashboardArrival();
  recordDashboardDeparture(second, true);
  history.replaceState(null, '', second);
  completeDashboardArrival();
  expect(canReturnThroughHistory('/overview')).toBe(true);
});

it('builds a property notification link with a bounded return destination', () => {
  expect(dashboardSection('//external.example/')).toBeUndefined();
  expect(dashboardSection('constructor')).toBeUndefined();
  expect(propertySmsHref('a&b', dashboardSection('overview'))).toBe('/sms-rules?property=a%26b&via=property&propertyVia=overview');
});
