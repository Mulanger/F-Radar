import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { detailSceneConfig, portfolioSceneConfig, solveFraming, type SceneConfig } from '@/components/three/property-scene';

/**
 * The property hero must show the whole island (incl. its base) and the tallest building
 * above the bottom stat panel and below the top label, for every card size and orbit angle.
 */
function extents(c: SceneConfig, W: number, H: number) {
  const { dist, ty } = solveFraming(c, W, H);
  const cam = new T.PerspectiveCamera(28, W / H, 0.1, 400);
  const pts: T.Vector3[] = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    pts.push(new T.Vector3(Math.cos(a) * (c.outer + 0.1), -0.1, Math.sin(a) * (c.outer + 0.1)));
    pts.push(new T.Vector3(Math.cos(a) * (c.outer - 0.25), -0.9, Math.sin(a) * (c.outer - 0.25)));
  }
  for (const b of c.buildings) {
    const top = 0.25 + 0.1 + b.f * 0.34 + 0.27;
    pts.push(new T.Vector3(b.x - b.w / 2, top, b.z - b.d / 2), new T.Vector3(b.x + b.w / 2, top, b.z + b.d / 2));
  }
  let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
  for (let k = 0; k < 24; k++) {
    const ang = (k / 24) * Math.PI * 2 + 0.3; // angles not used by the solver's own sampling
    cam.position.set(Math.cos(ang) * dist, c.h * (dist / c.dist), Math.sin(ang) * dist);
    cam.lookAt(0, ty, 0);
    cam.updateMatrixWorld();
    for (const p of pts) {
      const v = p.clone().project(cam);
      const px = ((v.x + 1) / 2) * W;
      const py = ((1 - v.y) / 2) * H;
      top = Math.min(top, py);
      bottom = Math.max(bottom, py);
      left = Math.min(left, px);
      right = Math.max(right, px);
    }
  }
  return { top, bottom, left, right };
}

describe('property hero framing', () => {
  const sizes: Array<[number, number]> = [[1036, 482], [1036, 630], [734, 482], [734, 630], [988, 482], [560, 480]];
  for (const floors of [2, 6, 10, 12]) {
    for (const [W, H] of sizes) {
      it(`keeps the island and a ${floors}-floor building inside the safe area at ${W}×${H}`, () => {
        const c = detailSceneConfig(floors, 0x3fa66b, 'High');
        const e = extents(c, W, H);
        const fit = c.fit!;
        const tol = 6; // px – orbit angles between the solver's samples
        expect(e.top).toBeGreaterThanOrEqual(fit.top - tol);
        expect(e.bottom).toBeLessThanOrEqual(H - fit.bottom + tol);
        expect(e.left).toBeGreaterThanOrEqual(fit.side - tol);
        expect(e.right).toBeLessThanOrEqual(W - fit.side + tol);
      });
    }
  }

  it('leaves the portfolio hero (dashboard) framing unchanged', () => {
    const c = portfolioSceneConfig();
    expect(c.fit).toBeUndefined();
    expect(solveFraming(c, 1000, 480)).toEqual({ dist: c.dist, ty: c.ty });
  });
});
