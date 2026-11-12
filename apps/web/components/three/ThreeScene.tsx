'use client';

import { useEffect, useRef } from 'react';
import type { SceneConfig, SceneHandle } from './property-scene';

/**
 * Mounts the 3D scene into an absolutely positioned container. three.js is loaded
 * lazily (code-split) so it never blocks first paint. If WebGL is unavailable the
 * container simply stays empty and the card's gradient background remains (fallback).
 *
 * `config` changes call `handle.update()` (no remount), matching the prototype's
 * behaviour when switching properties.
 */
export function ThreeScene({ config }: { config: SceneConfig }) {
  const elRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let cancelled = false;
    import('./property-scene')
      .then(({ createPropertyScene }) => {
        if (cancelled || !el.isConnected) return;
        try {
          handleRef.current = createPropertyScene(el, configRef.current);
        } catch (e) {
          console.warn('3D scene unavailable', e instanceof Error ? e.message : e);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  const key = JSON.stringify(config);
  useEffect(() => {
    handleRef.current?.update(configRef.current);
  }, [key]);

  return <div ref={elRef} style={{ position: 'absolute', inset: 0 }} aria-hidden="true" />;
}
