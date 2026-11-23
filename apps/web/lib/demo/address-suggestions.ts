import type { AddressSuggestionDto } from '@fastighetsradar/domain';

const PLACES = [
  { label: 'Trossö, Karlskrona', lat: 56.1612, lon: 15.5869 },
  { label: 'Spånga, Stockholm', lat: 59.383, lon: 17.908 },
  { label: 'Stockholm', lat: 59.3293, lon: 18.0686 },
  { label: 'Uppsala', lat: 59.8586, lon: 17.6389 },
  { label: 'Karlskrona', lat: 56.1612, lon: 15.5869 },
];

/** Local examples for trying the map confirmation without a live geocoding request. */
export function demoAddressSuggestions(query: string): AddressSuggestionDto[] {
  const key = query.toLocaleLowerCase('sv');
  return PLACES.filter((p) => p.label.toLocaleLowerCase('sv').startsWith(key))
    .map((p) => ({ ...p, provider: 'geoapify', precision: 'approximate' }));
}
