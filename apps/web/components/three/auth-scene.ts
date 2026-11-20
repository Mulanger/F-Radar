import * as T from 'three';

/**
 * 3D scene for the sign-in / sign-up panel – ported 1:1 from the approved design
 * (`auth-scene.js` in "Autentisering med 3D-scen"). Base (island, buildings, water ring, alert
 * rings, particles) matches `property-scene.ts`; the design adds a radar sweep, clouds with rain
 * over a warned property, alert pins, boats on the water ring and wind turbines on islets.
 *
 * Differences from the design file:
 *  - three.js is bundled locally (no runtime CDN import).
 *  - No `preserveDrawingBuffer` (it only existed for design-tool screenshots).
 */

export interface AuthSceneOptions {
  /** Clouds, radar, pins, boats and turbines. */
  extras: boolean;
  /** Clouds, rain and floating pins, when extras are enabled. */
  skyEffects: boolean;
  /** Orbit speed multiplier. */
  speed: number;
  /** >1 moves the camera closer; never crops the island sideways. */
  zoom: number;
  /** Vertical view offset as a fraction of the canvas height. */
  offsetY: number;
}

export interface AuthSceneHandle {
  set(next: Partial<AuthSceneOptions>): void;
  dispose(): void;
}

const ISL = 3.4;
const OUT = 5.7;
const AMP = 0.06;
const RING = 0x5aa6c2;

interface Building { x: number; z: number; w: number; d: number; f: number; hot?: number }

const BUILDINGS: Building[] = [
  { x: 0.2, z: 0.1, w: 1.1, d: 1.1, f: 11 },
  { x: -1.6, z: 0.9, w: 1.2, d: 0.9, f: 6 },
  { x: 1.7, z: -0.6, w: 0.9, d: 1.3, f: 8, hot: 0xd8473a },
  { x: 0.9, z: 1.9, w: 1.3, d: 0.8, f: 4 },
  { x: -0.8, z: -1.8, w: 1.0, d: 0.9, f: 7, hot: 0xe08a2e },
  { x: -2.3, z: -0.9, w: 0.8, d: 0.8, f: 3 },
  { x: 2.3, z: 1.3, w: 0.7, d: 0.7, f: 5 },
  { x: 1.4, z: -2.3, w: 0.8, d: 0.6, f: 3, hot: 0xe08a2e },
];
const TREES: Array<[number, number, number]> = [[-2.6, 0.9, 1], [-1.9, 2.2, 1.2], [2.6, -1.3, 0.9], [-0.2, 2.8, 1], [0.4, -2.9, 1.1], [-2.8, -2.0, 0.8], [2.9, 0.1, 0.9]];
const PUFFS: Array<[number, number, number, number]> = [[0, 0, 0, 0.55], [0.52, -0.06, 0.08, 0.42], [-0.5, -0.08, -0.04, 0.4], [0.18, 0.26, -0.06, 0.4], [-0.2, 0.2, 0.16, 0.34], [0.86, -0.12, -0.05, 0.28]];

const waveY = (x: number, z: number, t: number) =>
  AMP * (Math.sin(x * 1.5 + t * 1.3) + 0.7 * Math.sin(z * 1.8 - t * 1.05) + 0.3 * Math.sin((x + z) * 3.2 + t * 2.2));

export function createAuthScene(el: HTMLElement, opts?: Partial<AuthSceneOptions>): AuthSceneHandle {
  const o: AuthSceneOptions = { extras: true, skyEffects: true, speed: 1, zoom: 1, offsetY: 0, ...opts };
  const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const cv = renderer.domElement;
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity 1.2s;cursor:grab;touch-action:pan-y';
  cv.setAttribute('aria-hidden', 'true');
  el.appendChild(cv);

  const scene = new T.Scene();
  const cam = new T.PerspectiveCamera(28, 1, 0.1, 200);
  scene.add(new T.HemisphereLight(0xffffff, 0xd3dee3, 1.7));
  const sun = new T.DirectionalLight(0xfff8ef, 2.3);
  sun.position.set(7, 14, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 45 });
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
    cloud: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }),
    cloudRain: new T.MeshStandardMaterial({ color: 0xd6dfe4, roughness: 0.95 }),
    rain: new T.LineBasicMaterial({ color: 0x5f9cb5, transparent: true, opacity: 0.6 }),
  };

  const box = (w: number, h: number, d: number, m: T.Material, x: number, y: number, z: number) => {
    const b = new T.Mesh(new T.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = true;
    b.receiveShadow = true;
    return b;
  };

  const glows: Array<{ m: T.Mesh; mat: T.MeshBasicMaterial; o: number }> = [];
  const makeB = (b: Building) => {
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
    if (b.hot) {
      const gm = new T.MeshBasicMaterial({ color: b.hot, transparent: true, opacity: 0.5, depthWrite: false, side: T.DoubleSide });
      const r0 = Math.max(b.w, b.d) * 0.75;
      const gr = new T.Mesh(new T.RingGeometry(r0, r0 + 0.05, 64), gm);
      gr.rotation.x = -Math.PI / 2;
      gr.position.y = y0 + 0.11;
      g.add(gr);
      glows.push({ m: gr, mat: gm, o: Math.random() * 2 });
    }
    g.position.set(b.x, 0, b.z);
    return g;
  };

  // ---- Base (same as the dashboard scene) ----
  const base = new T.Mesh(new T.CylinderGeometry(OUT + 0.1, OUT - 0.25, 0.8, 128), M.base);
  base.position.y = -0.5;
  base.receiveShadow = true;
  scene.add(base);
  const waterGeo = new T.RingGeometry(ISL - 0.1, OUT + 0.08, 180, 18);
  waterGeo.rotateX(-Math.PI / 2);
  const wBase = (waterGeo.attributes.position!.array as Float32Array).slice();
  const water = new T.Mesh(waterGeo, M.water);
  water.position.y = -0.04;
  water.receiveShadow = true;
  scene.add(water);
  const isl = new T.Mesh(new T.CylinderGeometry(ISL, ISL + 0.18, 0.4, 96), M.island);
  isl.position.y = 0.05;
  isl.castShadow = true;
  isl.receiveShadow = true;
  scene.add(isl);
  const lawn = new T.Mesh(new T.CylinderGeometry(ISL - 0.22, ISL - 0.22, 0.02, 96), M.lawn);
  lawn.position.y = 0.255;
  lawn.receiveShadow = true;
  scene.add(lawn);
  BUILDINGS.forEach((b) => scene.add(makeB(b)));
  TREES.forEach(([x, z, s]) => {
    const t = new T.Mesh(new T.SphereGeometry(0.2 * s, 20, 16), M.tree);
    t.position.set(x, 0.27 + 0.2 * s, z);
    t.castShadow = true;
    scene.add(t);
  });
  const ringMat = new T.MeshBasicMaterial({ color: RING, transparent: true, opacity: 0.5, side: T.DoubleSide, depthWrite: false });
  const ring = new T.Mesh(new T.RingGeometry(ISL + 0.25, ISL + 0.31, 160), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  scene.add(ring);
  const N = 160;
  const pArr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * OUT;
    pArr[i * 3] = Math.cos(a) * rr;
    pArr[i * 3 + 1] = Math.random() * 5;
    pArr[i * 3 + 2] = Math.sin(a) * rr;
  }
  const pGeo = new T.BufferGeometry();
  pGeo.setAttribute('position', new T.BufferAttribute(pArr, 3));
  const pts = new T.Points(pGeo, new T.PointsMaterial({ color: 0x7fb6cc, size: 0.055, transparent: true, opacity: 0.75, depthWrite: false }));
  scene.add(pts);

  // ---- Extras ----
  const ex = new T.Group();
  scene.add(ex);

  // Radar sweep over the island
  const sweepMat = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    uniforms: { uA: { value: 0 }, uC: { value: new T.Color(RING) }, uR: { value: ISL - 0.24 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:
      'uniform float uA; uniform vec3 uC; uniform float uR; varying vec2 vP;\n' +
      'void main(){ float r = length(vP) / uR; float a = atan(vP.y, vP.x); float d = mod(uA - a, 6.2831853);\n' +
      ' float trail = pow(1.0 - clamp(d / 1.5, 0.0, 1.0), 2.4); float edge = 1.0 - smoothstep(0.0, 0.04, d);\n' +
      ' float rings = 1.0 - smoothstep(0.0, 0.012, abs(fract(r * 3.0) - 0.5) - 0.485);\n' +
      ' float fade = 1.0 - smoothstep(0.9, 1.0, r);\n' +
      ' gl_FragColor = vec4(uC, (trail * 0.34 + edge * 0.6 + rings * 0.08) * fade); }',
  });
  const sweep = new T.Mesh(new T.CircleGeometry(ISL - 0.24, 96), sweepMat);
  sweep.rotation.x = -Math.PI / 2;
  sweep.position.y = 0.275;
  sweep.renderOrder = 2;
  ex.add(sweep);

  const sky = new T.Group();
  sky.visible = o.skyEffects;
  ex.add(sky);

  // Clouds
  const makeCloud = (s: number, mat: T.Material) => {
    const g = new T.Group();
    PUFFS.forEach(([x, y, z, r]) => {
      const m = new T.Mesh(new T.SphereGeometry(r, 24, 16), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
    });
    g.scale.set(s, s * 0.82, s);
    return g;
  };
  const clouds = [
    { r: 4.7, h: 4.6, a: 0.5, s: 1.0, v: 0.03 },
    { r: 5.4, h: 5.6, a: 2.7, s: 0.8, v: 0.025 },
    { r: 3.9, h: 6.3, a: 4.5, s: 0.62, v: 0.035 },
  ].map((c) => {
    const g = makeCloud(c.s, M.cloud);
    sky.add(g);
    return { ...c, g };
  });

  // Rain cloud over a warned property
  const RB = BUILDINGS[7]!;
  const rainCloud = makeCloud(0.72, M.cloudRain);
  rainCloud.position.set(RB.x, 4.4, RB.z);
  sky.add(rainCloud);
  const RN = 80;
  const rTop = 4.05;
  const rBot = 1.42;
  const rPos = new Float32Array(RN * 6);
  const rSeed = Array.from({ length: RN }, () => [RB.x + (Math.random() - 0.5) * 0.95, RB.z + (Math.random() - 0.5) * 0.6, Math.random(), 0.8 + Math.random() * 0.4] as const);
  const rainGeo = new T.BufferGeometry();
  rainGeo.setAttribute('position', new T.BufferAttribute(rPos, 3));
  sky.add(new T.LineSegments(rainGeo, M.rain));

  // Alert pins
  const pins = BUILDINGS.filter((b) => b.hot).map((b, i) => {
    const top = 0.35 + b.f * 0.34 + 0.27;
    const mat = new T.MeshStandardMaterial({ color: b.hot, roughness: 0.35, emissive: b.hot, emissiveIntensity: 0.22 });
    const g = new T.Group();
    const head = new T.Mesh(new T.SphereGeometry(0.15, 24, 16), mat);
    head.position.y = 0.2;
    head.castShadow = true;
    const tip = new T.Mesh(new T.ConeGeometry(0.105, 0.24, 24), mat);
    tip.rotation.x = Math.PI;
    tip.position.y = 0.04;
    const dot = new T.Mesh(new T.SphereGeometry(0.055, 16, 12), M.slab);
    dot.position.set(0, 0.2, 0.11);
    const stem = new T.Mesh(new T.CylinderGeometry(0.007, 0.007, 0.55, 6), new T.MeshBasicMaterial({ color: b.hot, transparent: true, opacity: 0.45 }));
    stem.position.y = -0.36;
    g.add(head, tip, dot, stem);
    g.position.set(b.x, top + 0.62, b.z);
    sky.add(g);
    return { g, y: top + 0.62, o: i * 1.4 };
  });

  // Boats on the water ring
  const boats = [0.3, 2.4, 4.4].map((a, i) => {
    const g = new T.Group();
    g.add(box(0.46, 0.1, 0.17, M.slab, 0, 0, 0));
    g.add(box(0.16, 0.1, 0.12, M.glass, -0.06, 0.1, 0));
    g.add(box(0.2, 0.025, 0.14, M.slab, -0.06, 0.165, 0));
    ex.add(g);
    return { g, a, r: 4.12 + (i % 2) * 0.32, v: i % 2 ? -0.075 : 0.06 };
  });

  // Wind turbines on islets
  const turbines = [1.05, 3.95].map((a) => {
    const g = new T.Group();
    const islet = new T.Mesh(new T.CylinderGeometry(0.34, 0.42, 0.34, 40), M.island);
    islet.castShadow = true;
    islet.receiveShadow = true;
    const lw = new T.Mesh(new T.CylinderGeometry(0.27, 0.27, 0.02, 40), M.lawn);
    lw.position.y = 0.175;
    const tower = new T.Mesh(new T.CylinderGeometry(0.022, 0.04, 1.7, 12), M.slab);
    tower.position.y = 1.02;
    tower.castShadow = true;
    const nac = box(0.17, 0.08, 0.08, M.slab, 0.03, 1.89, 0);
    const rotor = new T.Group();
    rotor.position.set(0.13, 1.89, 0);
    for (let k = 0; k < 3; k++) {
      const p = new T.Group();
      p.rotation.x = (k * Math.PI * 2) / 3;
      p.add(box(0.012, 0.6, 0.045, M.slab, 0, 0.3, 0));
      rotor.add(p);
    }
    rotor.add(new T.Mesh(new T.SphereGeometry(0.04, 12, 10), M.slab));
    g.add(islet, lw, tower, nac, rotor);
    g.position.set(Math.cos(a) * 5.0, 0, Math.sin(a) * 5.0);
    g.rotation.y = -a;
    ex.add(g);
    return { rotor, o: a };
  });
  ex.visible = o.extras;

  // ---- Camera ----
  let W = 1;
  let H = 1;
  let last = 0;
  let ang = 0.75;
  let drag = 0;
  let visible = true;
  let first = true;
  const tanV = Math.tan(T.MathUtils.degToRad(14));

  const frame = (t: number, dt: number) => {
    const a = waterGeo.attributes.position!.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) a[i + 1] = waveY(wBase[i]!, wBase[i + 2]!, t);
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
    if (!reduced) {
      for (let i = 0; i < pArr.length; i += 3) {
        pArr[i + 1]! += 0.006;
        if (pArr[i + 1]! > 5.5) pArr[i + 1] = 0.2;
      }
      pGeo.attributes.position!.needsUpdate = true;
    }
    pts.rotation.y = t * 0.03;

    if (ex.visible && sky.visible) {
      clouds.forEach((c) => {
        const ca = c.a + t * c.v;
        c.g.position.set(Math.cos(ca) * c.r, c.h + Math.sin(t * 0.4 + c.a) * 0.12, Math.sin(ca) * c.r);
      });
      rainCloud.position.y = 4.4 + Math.sin(t * 0.6) * 0.05;
      for (let i = 0; i < RN; i++) {
        const [x, z, y0, sp] = rSeed[i]!;
        const y = rTop - ((y0 + t * 1.5 * sp) % 1) * (rTop - rBot);
        rPos.set([x, y, z, x, y - 0.16, z], i * 6);
      }
      rainGeo.attributes.position!.needsUpdate = true;
      pins.forEach((p) => {
        p.g.position.y = p.y + Math.sin(t * 1.6 + p.o) * 0.07;
        p.g.rotation.y = t * 0.8 + p.o;
      });
    }

    if (ex.visible) {
      sweepMat.uniforms.uA!.value = t * 0.9;
      boats.forEach((b) => {
        const ba = b.a + t * b.v;
        const x = Math.cos(ba) * b.r;
        const z = Math.sin(ba) * b.r;
        b.g.position.set(x, waveY(x, z, t) + 0.02, z);
        b.g.rotation.y = b.v > 0 ? -ba - Math.PI / 2 : -ba + Math.PI / 2;
        b.g.rotation.z = Math.sin(t * 1.7 + b.a) * 0.05;
      });
      turbines.forEach((tb) => {
        tb.rotor.rotation.x = t * 1.8 + tb.o;
      });
    }

    ang += dt * 0.05 * o.speed;
    const asp = W / H;
    // The whole base (radius ~5.8 + islets) must always fit horizontally; zoom never crops the sides.
    const dFit = 6.7 / (tanV * asp * 1.14);
    const dd = Math.max(dFit, 21 / o.zoom);
    const A = ang + drag;
    cam.position.set(Math.cos(A) * dd, (11.5 / 21) * dd, Math.sin(A) * dd);
    cam.lookAt(0, 1.3, 0);
    renderer.render(scene, cam);
    if (first) {
      first = false;
      requestAnimationFrame(() => {
        cv.style.opacity = '1';
      });
    }
  };

  const resize = () => {
    W = Math.max(1, el.clientWidth);
    H = Math.max(1, el.clientHeight);
    renderer.setSize(W, H, false);
    cam.aspect = W / H;
    if (o.offsetY) cam.setViewOffset(W, H, 0, -H * o.offsetY, W, H);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    frame(last, 0);
  };

  // Drag to rotate
  let dragging = false;
  let lx = 0;
  const down = (e: PointerEvent) => {
    dragging = true;
    lx = e.clientX;
    try {
      cv.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    cv.style.cursor = 'grabbing';
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    drag -= (e.clientX - lx) * 0.006;
    lx = e.clientX;
    if (reduced) frame(last, 0);
  };
  const up = () => {
    dragging = false;
    cv.style.cursor = 'grab';
  };
  cv.addEventListener('pointerdown', down);
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);

  const ro = new ResizeObserver(resize);
  ro.observe(el);
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((en) => {
        visible = !!en[0]?.isIntersecting;
      })
    : null;
  io?.observe(el);
  resize();

  const clock = new T.Clock();
  let raf = 0;
  let disposed = false;
  let prev = 0;
  const tick = () => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const t = clock.getElapsedTime();
    const dt = Math.min(0.1, t - prev);
    prev = t;
    if (!visible) return;
    last = t;
    frame(t, dt);
  };
  if (reduced) frame(0, 0);
  else tick();

  return {
    set(next) {
      Object.assign(o, next);
      ex.visible = o.extras;
      sky.visible = o.skyEffects;
      resize();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io?.disconnect();
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
      scene.traverse((obj) => {
        const mesh = obj as T.Mesh;
        mesh.geometry?.dispose();
        const m = mesh.material as T.Material | T.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      });
      sun.shadow.map?.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      cv.remove();
    },
  };
}
