import { z } from 'zod';

/**
 * Swedish UI support for validation messages (the product's audience is Swedish).
 * Call once in the browser bundle before validating user input; zod then produces
 * Swedish default messages (e.g. "För lite(t): …").
 */
let configured = false;
export function configureSwedishValidation(): void {
  if (configured) return;
  z.config(z.locales.sv());
  configured = true;
}

/** Swedish labels for property input paths shown in validation errors. */
export const FIELD_LABELS_SV: Record<string, string> = {
  name: 'Namn',
  address: 'Adress',
  location: 'Position',
  'location.lat': 'Latitud',
  'location.lon': 'Longitud',
  geocode: 'Adressträff',
  input: 'Indata',
};

export function fieldLabelSv(path: string): string {
  return FIELD_LABELS_SV[path] ?? FIELD_LABELS_SV[path.split('.')[0] ?? ''] ?? path;
}
