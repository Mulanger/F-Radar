/**
 * Organisation lookup for the invoice order modal.
 *
 * PLACEHOLDER: there is no company register integration yet. Every valid organisation number resolves,
 * after a short simulated delay, to the example organisation from the approved design so the flow can
 * be clicked through. Replace with a real lookup (BFF → API) when checkout is built.
 */
export interface OrganizationInfo {
  name: string;
  address: string;
}

export const EXAMPLE_ORGANIZATION: OrganizationInfo = { name: 'Brf Sjöstaden Kaj', address: 'Hammarby Kaj 12, 120 30 Stockholm' };
export const LOOKUP_DELAY_MS = 700;

export function lookupOrganization(_digits: string, signal?: AbortSignal): Promise<OrganizationInfo> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(EXAMPLE_ORGANIZATION), LOOKUP_DELAY_MS);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}
