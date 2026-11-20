export interface SceneBuilding {
  x: number;
  z: number;
  w: number;
  d: number;
  f: number;
  hot?: number;
  main?: boolean;
}

export interface SceneConfig {
  island: number;
  outer: number;
  amp: number;
  ring: number;
  dist: number;
  h: number;
  ty: number;
  shift: number;
  buildings: SceneBuilding[];
  trees: Array<[number, number, number]>;
  /**
   * Auto-framing: keep the whole island (incl. its base) and the tallest building inside the
   * canvas minus these pixel insets (where HTML overlays sit). Distance and look-at height are
   * solved per canvas size; viewing angle, orbit and style stay as designed. Omitted = fixed
   * prototype framing (portfolio hero).
   */
  fit?: { top: number; bottom: number; side: number };
}

export function portfolioSceneConfig(): SceneConfig {
  return {
    island: 3.4, outer: 5.7, amp: 0.06, ring: 0x5aa6c2, dist: 21, h: 11.5, ty: 1.3, shift: 0.17,
    buildings: [
      { x: 0.2, z: 0.1, w: 1.1, d: 1.1, f: 11 },
      { x: -1.6, z: 0.9, w: 1.2, d: 0.9, f: 6 },
      { x: 1.7, z: -0.6, w: 0.9, d: 1.3, f: 8, hot: 0xd8473a },
      { x: 0.9, z: 1.9, w: 1.3, d: 0.8, f: 4 },
      { x: -0.8, z: -1.8, w: 1.0, d: 0.9, f: 7, hot: 0xe08a2e },
      { x: -2.3, z: -0.9, w: 0.8, d: 0.8, f: 3 },
      { x: 2.3, z: 1.3, w: 0.7, d: 0.7, f: 5 },
      { x: 1.4, z: -2.3, w: 0.8, d: 0.6, f: 3, hot: 0xe08a2e },
    ],
    trees: [[-2.6, 0.9, 1], [-1.9, 2.2, 1.2], [2.6, -1.3, 0.9], [-0.2, 2.8, 1], [0.4, -2.9, 1.1], [-2.8, -2.0, 0.8], [2.9, 0.1, 0.9]],
  };
}
