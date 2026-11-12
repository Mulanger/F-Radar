import type { EventFeedProvider, ForecastProvider, ObservationProvider } from '../types';
import { notImplemented } from '../not-implemented';

/**
 * SMHI adapters (IMPLEMENTATION.md §9.1–9.3).
 * TODO(Agent 2 / Phase 4):
 *  - Forecast: SNOW1gv1 point endpoint `${SMHI_FORECAST_BASE_URL}/category/snow1g/version/1/geotype/point/lon/{lon}/lat/{lat}/data.json`.
 *    Verify parameter keys/units against parameter.json first; cache per grid point.
 *  - Warnings: IBWW `warning.json` + `metadata.json`; keep official text unaltered.
 *  - Observations: MetObs nearest relevant station with fresh data; show station distance.
 */
export const smhiForecastAdapter: ForecastProvider = {
  id: 'smhi_forecast',
  getPointForecast: () => notImplemented('smhi_forecast'),
};

export const smhiWarningsAdapter: EventFeedProvider = {
  id: 'smhi_warnings',
  fetchActive: () => notImplemented('smhi_warnings'),
};

export const smhiObservationsAdapter: ObservationProvider = {
  id: 'smhi_observations',
  getNearestObservations: () => notImplemented('smhi_observations'),
};
