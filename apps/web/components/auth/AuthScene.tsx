'use client';

import { useEffect, useRef } from 'react';
import type { AuthSceneHandle, AuthSceneOptions } from '../three/auth-scene';

/**
 * Mounts the sign-in 3D scene. three.js is code-split and loaded after first paint; without
 * WebGL the panel keeps its gradient background. Option changes are applied without a remount.
 */
export function AuthScene({ options, className }: { options: Partial<AuthSceneOptions>; className?: string }) {
  const elRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<AuthSceneHandle | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let cancelled = false;
    import('../three/auth-scene')
      .then(({ createAuthScene }) => {
        if (cancelled || !el.isConnected) return;
        try {
          handleRef.current = createAuthScene(el, optionsRef.current);
        } catch (e) {
          console.warn('3D-scen ej tillgänglig', e instanceof Error ? e.message : e);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  const key = JSON.stringify(options);
  useEffect(() => {
    handleRef.current?.set(optionsRef.current);
  }, [key]);

  return <div ref={elRef} className={className} aria-hidden="true" />;
}
