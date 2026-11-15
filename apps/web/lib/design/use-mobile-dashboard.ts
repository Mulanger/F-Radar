'use client';

import { useSyncExternalStore } from 'react';

const query = '(max-width: 899.98px)';
function subscribe(onChange: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
const snapshot = () => window.matchMedia(query).matches;
const serverSnapshot = () => false;

/** Subscribe after hydration; the server and first client render always agree. */
export function useMobileDashboard() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

const subscribePlatform = () => () => {};
const androidSnapshot = () => /Android/i.test(navigator.userAgent);
export function useAndroidNavigation() {
  return useSyncExternalStore(subscribePlatform, androidSnapshot, serverSnapshot);
}
