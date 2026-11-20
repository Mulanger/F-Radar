'use client';

import { ThreeScene } from '../three/ThreeScene';
import { portfolioSceneConfig } from '../three/scene-config';
import s from './CredentialFrame.module.css';

const scene = {
  ...portfolioSceneConfig(),
  shift: 0,
  fit: { top: 14, bottom: 22, side: 22 },
};

export function CredentialScene() {
  return (
    <div className={s.scene}>
      <div className={s.poster} />
      <ThreeScene config={scene} />
    </div>
  );
}
