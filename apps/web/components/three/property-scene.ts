import * as T from 'three';

/**
 * Stylised 3D "property twin" scene – ported 1:1 from the approved prototype
 * (`_buildScene` in FastighetsRadar.dc.html): island platform, glass/slab buildings,
 * animated water ring, pulsing alert rings, rising particles and slow orbit camera.
 *
 * The scene is a generic ILLUSTRATION, not a model of the customer's building, and the
 * water animation is decorative (IMPLEMENTATION.md §9.7, §14.3).
 *
 * Differences from the prototype (engineering only, no visual change):
 *  - three.js is bundled locally (no runtime CDN import).
 *  - All geometries/materials are disposed on rebuild and teardown; WebGL context is released.
 *  - prefers-reduced-motion renders a static frame instead of a continuous loop.
 */

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
}

export interface SceneHandle {
  update(cfg: SceneConfig): void;
  dispose(): void;
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

/** Per-property scene. `waterAmp` is purely decorative (derived from mapped exposure class). */
export function detailSceneConfig(floors: number, ringColor: number, exposure: string): SceneConfig {
  const f = floors;
  return {
    island: 2.6, outer: 4.7,
    amp: exposure === 'High' ? 0.1 : exposure === 'Medium' ? 0.065 : 0.035,
    ring: ringColor,
    dist: 13 + f * 0.45, h: 6.5 + f * 0.35, ty: 0.6 + f * 0.13, shift: 0,
    buildings: [
      { x: 0.1, z: -0.1, w: 1.5, d: 1.3, f, main: true },
      { x: -1.55, z: 0.6, w: 0.9, d: 1.3, f: Math.max(2, Math.round(f / 3)) },
      { x: 1.35, z: 1.1, w: 0.8, d: 0.8, f: 2 },
    ],
    trees: [[-1.4, -1.5, 1], [1.6, -1.2, 1.2], [-0.4, 1.9, 0.9], [1.9, 0.0, 0.8], [-2.0, -0.6, 0.9], [0.6, 1.95, 1]],
  };
}

function disposeObject(root: T.Object3D) {
  root.traverse((o) => {
    const mesh = o as T.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as T.Material | T.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat && !sharedMaterials.has(mat)) mat.dispose();
  });
}
// Materials shared across rebuilds are disposed only on final teardown.
const sharedMaterials = new WeakSet<T.Material>();

export function createPropertyScene(el: HTMLElement, initial: SceneConfig): SceneHandle {
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const cv = renderer.domElement;
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity 1.2s';
  cv.setAttribute('aria-hidden', 'true');
  el.appendChild(cv);

  const scene = new T.Scene();
  const cam = new T.PerspectiveCamera(28, 1, 0.1, 200);
  scene.add(new T.HemisphereLight(0xffffff, 0xd3dee3, 1.7));
  const sun = new T.DirectionalLight(0xfff8ef, 2.3);
  sun.position.set(7, 14, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
  sun.shadow.radius = 5;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const fill = new T.DirectionalLight(0xcfe3ff, 0.7);
  fill.position.set(-8, 5, -6);
  scene.add(fill);

  const M = {
    slab: new T.MeshStandardMaterial({ color: 0xfbfbf9, roughness: 0.45 }),
    glass: new T.MeshPhysicalMaterial({ color: 0x9dbecb, roughness: 0.1, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 }),
    island: new T.MeshStandardMaterial({ color: 0xeceeea, roughness: 0.9 }),
    lawn: new T.MeshStandardMaterial({ color: 0xd5ddcf, roughness: 1 }),
    tree: new T.MeshStandardMaterial({ color: 0xa9bca4, roughness: 0.85 }),
    base: new T.MeshStandardMaterial({ color: 0xf3f5f6, roughness: 0.3, metalness: 0.05 }),
    water: new T.MeshPhysicalMaterial({ color: 0x6ea8bf, roughness: 0.04, metalness: 0.12, transparent: true, opacity: 0.84, clearcoat: 1, clearcoatRoughness: 0.04 }),
  };
  Object.values(M).forEach((m) => sharedMaterials.add(m));

  let dyn = new T.Group();
  scene.add(dyn);
  let waterGeo!: T.RingGeometry;
  let wBase!: Float32Array;
  let ring!: T.Mesh;
  let ringMat!: T.MeshBasicMaterial;
  let glows: Array<{ m: T.Mesh; mat: T.MeshBasicMaterial; o: number }> = [];
  let pts!: T.Points;
  let pArr!: Float32Array;
  let amp = 0.05;
  let cfg: SceneConfig = initial;

  const box = (w: number, hh: number, d: number, m: T.Material, x: number, y: number, z: number) => {
    const o = new T.Mesh(new T.BoxGeometry(w, hh, d), m);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  };

  const makeB = (b: SceneBuilding) => {
    const g = new T.Group();
    const fh = 0.34;
    const y0 = 0.25;
    g.add(box(b.w + 0.16, 0.1, b.d + 0.16, M.slab, 0, y0 + 0.05, 0));
    for (let i = 0; i < b.f; i++) {
      const y = y0 + 0.1 + i * fh;
      g.add(box(b.w, 0.055, b.d, M.slab, 0, y + 0.0275, 0));
      g.add(box(b.w - 0.08, fh - 0.055, b.d - 0.08, M.glass, 0, y + 0.055 + (fh - 0.055) / 2, 0));
    }
    const top = y0 + 0.1 + b.f * fh;
    g.add(box(b.w + 0.04, 0.09, b.d + 0.04, M.slab, 0, top + 0.045, 0));
    g.add(box(b.w * 0.4, 0.18, b.d * 0.35, M.slab, b.w * 0.15, top + 0.18, -b.d * 0.1));
    ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).forEach(([sx, sz]) =>
      g.add(box(0.05, b.f * fh, 0.05, M.slab, sx * (b.w / 2 - 0.02), y0 + 0.1 + (b.f * fh) / 2, sz * (b.d / 2 - 0.02))),
    );
    if (b.hot || b.main) {
      const gm = new T.MeshBasicMaterial({ color: b.hot || cfg.ring, transparent: true, opacity: 0.5, depthWrite: false, side: T.DoubleSide });
      const gr = new T.Mesh(new T.RingGeometry(Math.max(b.w, b.d) * 0.75, Math.max(b.w, b.d) * 0.75 + 0.05, 64), gm);
      gr.rotation.x = -Math.PI / 2;
      gr.position.y = y0 + 0.11;
      g.add(gr);
      glows.push({ m: gr, mat: gm, o: Math.random() * 2 });
    }
    g.position.set(b.x, 0, b.z);
    return g;
  };

  let W = 1;
  let H = 1;
  const resize = () => {
    W = Math.max(1, el.clientWidth);
    H = Math.max(1, el.clientHeight);
    renderer.setSize(W, H, false);
    cam.aspect = W / H;
    if (cfg && cfg.shift) cam.setViewOffset(W, H, -W * cfg.shift, 0, W, H);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    if (reducedMotion) frame(0);
  };

  const build = (c: SceneConfig) => {
    cfg = c;
    glows = [];
    scene.remove(dyn);
    disposeObject(dyn);
    dyn = new T.Group();
    scene.add(dyn);
    const R = c.outer;
    const r = c.island;
    const base = new T.Mesh(new T.CylinderGeometry(R + 0.1, R - 0.25, 0.8, 128), M.base);
    base.position.y = -0.5;
    base.receiveShadow = true;
    dyn.add(base);
    waterGeo = new T.RingGeometry(r - 0.1, R + 0.08, 180, 18);
    waterGeo.rotateX(-Math.PI / 2);
    wBase = (waterGeo.attributes.position!.array as Float32Array).slice();
    const water = new T.Mesh(waterGeo, M.water);
    water.position.y = -0.04;
    water.receiveShadow = true;
    dyn.add(water);
    const isl = new T.Mesh(new T.CylinderGeometry(r, r + 0.18, 0.4, 96), M.island);
    isl.position.y = 0.05;
    isl.castShadow = true;
    isl.receiveShadow = true;
    dyn.add(isl);
    const lawn = new T.Mesh(new T.CylinderGeometry(r - 0.22, r - 0.22, 0.02, 96), M.lawn);
    lawn.position.y = 0.255;
    lawn.receiveShadow = true;
    dyn.add(lawn);
    c.buildings.forEach((b) => dyn.add(makeB(b)));
    c.trees.forEach(([x, z, s]) => {
      const t = new T.Mesh(new T.SphereGeometry(0.2 * s, 20, 16), M.tree);
      t.position.set(x, 0.27 + 0.2 * s, z);
      t.castShadow = true;
      dyn.add(t);
    });
    ringMat = new T.MeshBasicMaterial({ color: c.ring, transparent: true, opacity: 0.5, side: T.DoubleSide, depthWrite: false });
    ring = new T.Mesh(new T.RingGeometry(r + 0.25, r + 0.31, 160), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    dyn.add(ring);
    amp = c.amp;
    const N = 160;
    const g = new T.BufferGeometry();
    pArr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * R;
      pArr[i * 3] = Math.cos(a) * rr;
      pArr[i * 3 + 1] = Math.random() * 5;
      pArr[i * 3 + 2] = Math.sin(a) * rr;
    }
    g.setAttribute('position', new T.BufferAttribute(pArr, 3));
    pts = new T.Points(g, new T.PointsMaterial({ color: 0x7fb6cc, size: 0.055, transparent: true, opacity: 0.75, depthWrite: false }));
    dyn.add(pts);
    resize();
  };

  const frame = (t: number) => {
    if (!waterGeo) return;
    const a = waterGeo.attributes.position!.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      const x = wBase[i]!;
      const z = wBase[i + 2]!;
      a[i + 1] = amp * (Math.sin(x * 1.5 + t * 1.3) + 0.7 * Math.sin(z * 1.8 - t * 1.05) + 0.3 * Math.sin((x + z) * 3.2 + t * 2.2));
    }
    waterGeo.attributes.position!.needsUpdate = true;
    waterGeo.computeVertexNormals();
    const k = (t % 3) / 3;
    ring.scale.setScalar(1 + k * 0.32);
    ringMat.opacity = 0.55 * (1 - k);
    glows.forEach((g) => {
      const q = ((t + g.o) % 2) / 2;
      g.m.scale.setScalar(1 + q * 0.8);
      g.mat.opacity = 0.6 * (1 - q);
    });
    if (!reducedMotion) {
      for (let i = 0; i < pArr.length; i += 3) {
        pArr[i + 1]! += 0.006;
        if (pArr[i + 1]! > 5.5) pArr[i + 1] = 0.2;
      }
      pts.geometry.attributes.position!.needsUpdate = true;
    }
    pts.rotation.y = t * 0.03;
    const ang = t * 0.05 + 0.75;
    const aspect = W / H;
    const dd = cfg.dist * (aspect < 1.5 ? 1.5 / aspect : 1);
    cam.position.set(Math.cos(ang) * dd, cfg.h * (dd / cfg.dist), Math.sin(ang) * dd);
    cam.lookAt(0, cfg.ty, 0);
    renderer.render(scene, cam);
  };

  const ro = new ResizeObserver(resize);
  ro.observe(el);
  build(initial);

  const clock = new T.Clock();
  let raf = 0;
  let disposed = false;
  const tick = () => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    frame(clock.getElapsedTime());
  };
  if (reducedMotion) frame(0);
  else tick();
  const fadeIn = requestAnimationFrame(() => {
    cv.style.opacity = '1';
  });

  return {
    update: (c) => {
      build(c);
      if (reducedMotion) frame(0);
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(fadeIn);
      ro.disconnect();
      scene.remove(dyn);
      disposeObject(dyn);
      Object.values(M).forEach((m) => m.dispose());
      sun.shadow.map?.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      cv.remove();
    },
  };
}
