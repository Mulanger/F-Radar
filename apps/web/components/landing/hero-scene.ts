import * as T from 'three';
import { annotationPhase, stackCards } from '@/lib/landing/logic';
import type { SeverityKey } from '@/lib/landing/content';

/**
 * Landing-page hero scene, ported from the approved design ("FastighetsRadar Landningssida",
 * `initScene`): a floating island with four buildings, animated water, ice floes, a boat, a
 * pulsing alert beacon and HTML annotation cards that point at places in the scene.
 *
 * Engineering differences from the design file (no visual change):
 *  - three.js is the project's bundled copy (no runtime CDN import); r160 has no NeutralToneMapping,
 *    which the design already treats as optional (no tone mapping).
 *  - Every geometry, material, texture and the WebGL context are released on dispose.
 *  - Rendering pauses while the hero is off-screen; prefers-reduced-motion stops auto-rotation and
 *    the water animation.
 */

export interface AnnotationEls {
  el: HTMLElement;
  card: HTMLElement;
  dot: HTMLElement;
  line: HTMLElement;
}

export interface LandingSceneOptions {
  hero: HTMLElement;
  canvas: HTMLCanvasElement;
  /** The right-hand column the island is centred in and the cards are kept inside. */
  col: HTMLElement;
  annotations: Array<AnnotationEls | null>;
  sms: HTMLElement | null;
  severities: SeverityKey[];
  onSeverity: (s: SeverityKey) => void;
  /** Seconds each annotation card stays in focus (design default 2.6). */
  cardSeconds?: number;
  autoRotate?: boolean;
}

export interface LandingSceneHandle {
  dispose(): void;
}

const SEV_COLOR: Record<SeverityKey, string> = { normal: '#3FA66B', monitor: '#4A7FD0', warning: '#E08A2E', critical: '#D8473A' };
const SEV_RANK: Record<SeverityKey, number> = { normal: 0, monitor: 1, warning: 2, critical: 3 };
const CARD_W = 248;

interface Shown {
  i: number;
  w: AnnotationEls;
  e: number;
  f: number;
  ax: number;
  ay: number;
  far: number;
  left: number;
  top: number;
  ch: number;
  minTop: number;
  maxTop: number;
  age: number;
}

export function createLandingScene(o: LandingSceneOptions): LandingSceneHandle {
  const { hero, canvas, col } = o;
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const cleanup: Array<() => void> = [];
  const start = performance.now();

  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(26, 1, 0.5, 400);
  const target = new T.Vector3(0, 1.25, 0);
  const camDir = new T.Vector3(1, 0.8, 1).normalize();

  scene.add(new T.HemisphereLight(0xffffff, 0xd6dfe3, 2.0));
  const key = new T.DirectionalLight(0xffffff, 2.3);
  key.position.set(7, 14, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 5;
  scene.add(key);
  const fill = new T.DirectionalLight(0xe6eff4, 0.9);
  fill.position.set(-9, 6, -3);
  scene.add(fill);

  const mat = (c: string, extra: T.MeshStandardMaterialParameters = {}) => new T.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0, ...extra });
  const wall = mat('#F0F2F1');
  const glass = mat('#6A8EA2', { roughness: 0.28, metalness: 0.1 });
  const plaza = mat('#EEF0EE');
  const plinth = mat('#E2E6E4');
  const rim = mat('#DCE2E3');
  const ice = mat('#EDF2F3', { roughness: 0.6 });
  const leaf = mat('#BCCDB9');
  const trunk = mat('#B3ACA1');

  const world = new T.Group();
  scene.add(world);
  const add = (geo: T.BufferGeometry, m: T.Material, x = 0, y = 0, z = 0, parent: T.Object3D = world) => {
    const mesh = new T.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  /* Island base and water */
  const R = 6.4;
  add(new T.CylinderGeometry(R, R - 0.4, 0.8, 128), rim, 0, -0.4, 0).castShadow = false;
  const wGeo = new T.RingGeometry(0.001, R - 0.02, 180, 28);
  const water = new T.Mesh(wGeo, mat('#8BB9CA', { roughness: 0.3, metalness: 0.05 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.02;
  water.receiveShadow = true;
  world.add(water);
  const wPos = wGeo.attributes.position as T.BufferAttribute;
  const wBase = Float32Array.from(wPos.array as Float32Array);

  /* Ice floes */
  ([[0.3, 4.6, 0.55], [1.25, 4.4, 0.45], [2.2, 4.8, 0.5], [3.1, 4.5, 0.4], [3.9, 4.7, 0.6], [4.8, 4.4, 0.42], [5.6, 4.75, 0.5]] as const).forEach(([ang, rr, s], i) => {
    for (let k = 0; k < 3; k++) {
      const r = s * (0.55 + 0.22 * ((i + k) % 3));
      const a = ang + ((k - 1) * (s * 0.55)) / rr;
      const rad = rr + (((k * 7 + i * 3) % 5) - 2) * 0.06;
      const m = add(new T.CylinderGeometry(r, r, 0.05, 40), ice, Math.cos(a) * rad, 0.05, Math.sin(a) * rad);
      m.scale.z = 0.62;
      m.rotation.y = -a;
      m.castShadow = false;
    }
  });

  /* Plinth, plaza, path and pier */
  add(new T.CylinderGeometry(3.75, 3.95, 0.5, 96), plinth, 0, 0.25, 0);
  add(new T.CylinderGeometry(3.4, 3.45, 0.14, 96), plaza, 0, 0.57, 0);
  const TOP = 0.64;
  const path = new T.Mesh(new T.RingGeometry(2.95, 3.1, 96), mat('#E1E5E3'));
  path.rotation.x = -Math.PI / 2;
  path.position.y = TOP + 0.004;
  path.receiveShadow = true;
  world.add(path);
  add(new T.BoxGeometry(1.5, 0.12, 0.5), plinth, -1.55, 0.32, -3.95).rotation.y = 1.18;

  /* Buildings */
  const FH = 0.34;
  const building = (w: number, d: number, floors: number, x: number, z: number) => {
    const g = new T.Group();
    g.position.set(x, TOP, z);
    world.add(g);
    const h = floors * FH + 0.14;
    add(new T.BoxGeometry(w, h, d), wall, 0, h / 2, 0, g);
    const band = new T.BoxGeometry(w + 0.02, FH * 0.5, d + 0.02);
    for (let i = 0; i < floors; i++) add(band, glass, 0, 0.18 + i * FH + FH * 0.42, 0, g).castShadow = false;
    const fh = floors * FH;
    const my = 0.16 + fh / 2;
    const mx = new T.BoxGeometry(0.035, fh, 0.04);
    const mz = new T.BoxGeometry(0.04, fh, 0.035);
    const nx = Math.max(2, Math.round(w / 0.3));
    const nz = Math.max(2, Math.round(d / 0.3));
    for (let i = 1; i < nx; i++) for (const s of [1, -1]) add(mx, wall, -w / 2 + (i * w) / nx, my, s * (d / 2 + 0.02), g).castShadow = false;
    for (let i = 1; i < nz; i++) for (const s of [1, -1]) add(mz, wall, s * (w / 2 + 0.02), my, -d / 2 + (i * d) / nz, g).castShadow = false;
    add(new T.BoxGeometry(w + 0.06, 0.07, d + 0.06), wall, 0, h + 0.035, 0, g);
    add(new T.BoxGeometry(w * 0.42, 0.2, d * 0.34), wall, w * 0.12, h + 0.17, -d * 0.12, g);
    return h;
  };
  const hT = building(1.3, 1.3, 10, 0.25, -0.35);
  const hM = building(1.05, 1.7, 6, -1.7, -0.55);
  const hA = building(1.8, 0.95, 3, 1.2, 1.6);
  building(0.95, 0.95, 4, -0.95, 1.8);

  /* Trees */
  ([[2.45, -1.2, 0.27], [2.15, -2.15, 0.22], [-0.55, -2.45, 0.26], [-2.75, 1.0, 0.28], [0.35, 2.75, 0.22], [-2.3, -2.05, 0.24], [2.75, 0.45, 0.2], [-1.9, 2.5, 0.2]] as const).forEach(([x, z, r]) => {
    add(new T.CylinderGeometry(0.035, 0.05, 0.22, 8), trunk, x, TOP + 0.11, z);
    add(new T.SphereGeometry(r, 24, 16), leaf, x, TOP + 0.2 + r * 0.85, z);
  });

  /* Boat */
  const boat = new T.Group();
  boat.position.set(-2.55, 0.08, -4.75);
  boat.rotation.y = 1.18;
  world.add(boat);
  add(new T.BoxGeometry(1.0, 0.18, 0.38), wall, 0, 0.05, 0, boat);
  add(new T.BoxGeometry(0.38, 0.2, 0.28), mat('#D9E0E3'), -0.1, 0.24, 0, boat);

  /* Alert rings + beacon on the tall building */
  const ringMats: T.MeshBasicMaterial[] = [];
  const rings: T.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const m = new T.MeshBasicMaterial({ color: '#E08A2E', transparent: true, opacity: 0, depthWrite: false });
    const r = new T.Mesh(new T.RingGeometry(0.975, 1.0, 128), m);
    r.rotation.x = -Math.PI / 2;
    r.position.set(0.25, TOP + 0.012, -0.35);
    world.add(r);
    rings.push(r);
    ringMats.push(m);
  }
  const beaconMat = new T.MeshBasicMaterial({ color: '#E08A2E' });
  const beacon = new T.Mesh(new T.SphereGeometry(0.08, 16, 12), beaconMat);
  beacon.position.set(0.25 + 1.3 * 0.12, TOP + hT + 0.36, -0.35 - 1.3 * 0.12);
  world.add(beacon);

  /* Soft contact shadow under the island */
  const sc = document.createElement('canvas');
  sc.width = sc.height = 256;
  const g2 = sc.getContext('2d');
  if (g2) {
    const grd = g2.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(40,62,74,0.30)');
    grd.addColorStop(0.5, 'rgba(40,62,74,0.12)');
    grd.addColorStop(1, 'rgba(40,62,74,0)');
    g2.fillStyle = grd;
    g2.fillRect(0, 0, 256, 256);
  }
  const shadowTex = new T.CanvasTexture(sc);
  const shadow = new T.Mesh(new T.PlaneGeometry(17, 17), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.7;
  scene.add(shadow);

  /* Floating particles */
  const PC = 170;
  const pArr = new Float32Array(PC * 3);
  for (let i = 0; i < PC; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 7.5;
    pArr[i * 3] = Math.cos(a) * r;
    pArr[i * 3 + 1] = Math.random() * 7 - 0.5;
    pArr[i * 3 + 2] = Math.sin(a) * r;
  }
  const pGeo = new T.BufferGeometry();
  pGeo.setAttribute('position', new T.BufferAttribute(pArr, 3));
  const pts = new T.Points(pGeo, new T.PointsMaterial({ color: '#8E9AA3', size: 0.045, transparent: true, opacity: 0.55, depthWrite: false }));
  scene.add(pts);

  /* Annotation anchors (world space, before rotation) */
  const anchors = [
    [0.25, TOP + hT + 0.45, -0.35],
    [5.05, 0.12, 1.3],
    [-1.7, TOP + hM + 0.35, -0.55],
    [-2.55, 0.35, -4.75],
    [1.2, TOP + hA + 0.35, 1.6],
    [-2.75, TOP + 0.6, 1.0],
  ].map(([x, y, z]) => new T.Vector3(x, y, z));
  const curColor = new T.Color(SEV_COLOR.warning);
  const sevColors = Object.fromEntries(Object.entries(SEV_COLOR).map(([k, c]) => [k, new T.Color(c)])) as Record<SeverityKey, T.Color>;

  /* Layout: camera distance and view offset so the island sits in the right-hand column */
  let L: { W: number; H: number; col: { x: number; y: number; w: number; h: number } } | null = null;
  const cardH = o.annotations.map((a) => a?.card.offsetHeight || 96);
  /** Smoothed vertical offset per card from overlap avoidance, and whether it was visible last frame. */
  const shift = o.annotations.map(() => 0);
  const seen = o.annotations.map(() => false);
  /** Smoothed visibility factor: a card with no free slot waits (fades down) until there is room. */
  const room = o.annotations.map(() => 1);
  const layout = () => {
    const hr = hero.getBoundingClientRect();
    const cr = col.getBoundingClientRect();
    const W = Math.max(1, hr.width);
    const H = Math.max(1, hr.height);
    renderer.setSize(W, H, false);
    const cx = cr.left - hr.left + cr.width / 2;
    const cy = cr.top - hr.top + cr.height / 2;
    camera.aspect = W / H;
    const px = Math.max(260, Math.min(cr.width * 0.9, cr.height * 0.98));
    const tanH = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
    const d = (6.9 * H) / (px * tanH);
    camera.position.copy(target).addScaledVector(camDir, d);
    camera.lookAt(target);
    camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy - cr.height * 0.02, W, H);
    camera.updateProjectionMatrix();
    L = { W, H, col: { x: cr.left - hr.left, y: cr.top - hr.top, w: cr.width, h: cr.height } };
    o.annotations.forEach((a, i) => {
      if (a) cardH[i] = a.card.offsetHeight || 96;
    });
  };
  layout();
  const ro = new ResizeObserver(layout);
  ro.observe(hero);
  ro.observe(col);
  cleanup.push(() => ro.disconnect());
  document.fonts?.ready.then(() => !disposed && layout()).catch(() => undefined);

  let visible = true;
  const io = new IntersectionObserver((es) => {
    visible = es[0]?.isIntersecting ?? true;
  });
  io.observe(hero);
  cleanup.push(() => io.disconnect());

  /* Drag to rotate (pointer events: mouse, touch, pen) */
  let rotY = 0.55;
  let vel = 0;
  let dragging = false;
  let lastX = 0;
  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    vel = 0;
    canvas.style.cursor = 'grabbing';
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    rotY += dx * 0.006;
    vel = dx * 0.0036;
  };
  const onUp = () => {
    dragging = false;
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  cleanup.push(() => {
    canvas.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  });

  const v = new T.Vector3();
  const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
  const cardSeconds = o.cardSeconds ?? 2.6;
  const autoRotate = (o.autoRotate ?? true) && !reduced;
  const N = anchors.length;
  const cyc = Math.max(1.2, cardSeconds) * N;
  let currentSev: SeverityKey | null = null;
  let last = performance.now();
  let frame = 0;
  let raf = 0;
  let disposed = false;

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible || !L) return;
    frame++;
    const t = (now - start) / 1000;
    if (!dragging) {
      vel *= 0.94;
      rotY += vel + (autoRotate ? dt * 0.07 : 0);
    }
    world.rotation.y = rotY;
    if (!reduced) {
      world.position.y = Math.sin(t * 0.8) * 0.06;
      boat.position.y = 0.08 + Math.sin(t * 1.6) * 0.025;
      boat.rotation.z = Math.sin(t * 1.3) * 0.04;
      pts.rotation.y = t * 0.015;
      const arr = wPos.array as Float32Array;
      for (let j = 0; j < wPos.count; j++) {
        const x = wBase[j * 3]!;
        const y = wBase[j * 3 + 1]!;
        const r = Math.sqrt(x * x + y * y);
        const damp = 1 - Math.pow(r / R, 10);
        arr[j * 3 + 2] = damp * (0.05 * Math.sin(r * 2.1 - t * 1.4) + 0.035 * Math.sin(x * 1.1 + t * 0.9) * Math.cos(y * 1.3 - t * 0.6));
      }
      wPos.needsUpdate = true;
      if (frame % 2 === 0) wGeo.computeVertexNormals();
    }

    world.updateMatrixWorld();
    v.copy(target).project(camera);
    const sx = ((v.x + 1) / 2) * L.W;
    const sy = ((1 - v.y) / 2) * L.H;
    let sevMax: SeverityKey | null = null;
    const C = L.col;
    const shown: Shown[] = [];
    for (let i = 0; i < N; i++) {
      const w = o.annotations[i];
      if (!w) continue;
      const { e, active } = annotationPhase(i, t, cardSeconds, N);
      if (e <= 0.001) {
        if (w.el.style.opacity !== '0') w.el.style.opacity = '0';
        seen[i] = false;
        continue;
      }
      const sev = o.severities[i] ?? 'normal';
      if (active && (sevMax === null || SEV_RANK[sev] > SEV_RANK[sevMax])) sevMax = sev;
      v.copy(anchors[i]!).applyMatrix4(world.matrixWorld);
      const far = v.x * camDir.x + v.z * camDir.z;
      v.project(camera);
      const ax = ((v.x + 1) / 2) * L.W;
      const ay = ((1 - v.y) / 2) * L.H;
      let dx = ax - sx;
      let dy = ay - sy;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      const f = clamp(dx * 1.8, -1, 1);
      const fy = clamp(dy * 1.8, -1, 1);
      const ch = cardH[i] || 96;
      let left = ax + dx * 70 - CARD_W * (0.5 - 0.5 * f);
      let top = ay + dy * 50 - 24 - ch * (0.5 - 0.5 * fy);
      left = clamp(left, C.x + 14, C.x + C.w - CARD_W - 14);
      const minTop = C.y + 72;
      const maxTop = Math.max(minTop, C.y + C.h - ch - 104);
      top = clamp(top, minTop, maxTop);
      const age = (((t - i * Math.max(1.2, cardSeconds)) % cyc) + cyc) % cyc;
      shown.push({ i, w, e, f, ax, ay, far, left, top, ch, minTop, maxTop, age });
    }
    // Oldest card keeps its place; newer ones glide out of its way instead of covering it.
    shown.sort((a, b) => b.age - a.age);
    const tops = stackCards(shown.map((c) => ({ left: c.left, top: c.top, w: CARD_W, h: c.ch, minTop: c.minTop, maxTop: c.maxTop })));
    for (let k = 0; k < shown.length; k++) {
      const { i, w, e, f, ax, ay, far, left, ch } = shown[k]!;
      const want = tops[k]!.top - shown[k]!.top;
      shift[i] = seen[i] ? shift[i]! + (want - shift[i]!) * 0.12 : want;
      const roomTarget = tops[k]!.clear ? 1 : 0;
      room[i] = seen[i] ? room[i]! + (roomTarget - room[i]!) * 0.15 : roomTarget;
      seen[i] = true;
      const top = shown[k]!.top + shift[i]!;
      const bx = clamp(ax, left, left + CARD_W);
      const by = clamp(ay, top, top + ch);
      const len = Math.hypot(bx - ax, by - ay);
      const ang = Math.atan2(by - ay, bx - ax);
      w.el.style.opacity = (e * room[i]!).toFixed(3);
      w.card.style.transformOrigin = f >= 0 ? '0% 50%' : '100% 50%';
      w.card.style.transform = `translate3d(${left.toFixed(1)}px,${(top + (1 - e) * 16).toFixed(1)}px,0) perspective(800px) rotateY(${((1 - e) * (f >= 0 ? -42 : 42)).toFixed(2)}deg) scale(${(0.9 + 0.1 * e).toFixed(3)})`;
      w.dot.style.transform = `translate3d(${ax.toFixed(1)}px,${ay.toFixed(1)}px,0) scale(${(1 + 0.18 * Math.sin(t * 4 + i)).toFixed(3)})`;
      w.dot.style.opacity = far < -1.2 ? '0.45' : '1';
      w.line.style.width = `${(len * e).toFixed(1)}px`;
      w.line.style.transform = `translate3d(${ax.toFixed(1)}px,${ay.toFixed(1)}px,0) rotate(${ang.toFixed(4)}rad)`;
    }
    if (o.sms) {
      const sa = (((t - 0.9) % cyc) + cyc) % cyc;
      const SD = 3.8;
      const sk = sa < SD ? Math.min(1, sa / 0.45, (SD - sa) / 0.45) : 0;
      const se = 1 - Math.pow(1 - Math.max(0, sk), 3);
      o.sms.style.opacity = se.toFixed(3);
      o.sms.style.transform = `translate3d(0,${((1 - se) * -14).toFixed(1)}px,0) scale(${(0.96 + 0.04 * se).toFixed(3)})`;
    }
    const sev = sevMax ?? 'normal';
    if (sev !== currentSev) {
      currentSev = sev;
      o.onSeverity(sev);
    }
    curColor.lerp(sevColors[sev], 0.05);
    beaconMat.color.copy(curColor);
    beacon.scale.setScalar(1 + 0.35 * Math.sin(t * 3));
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.42 + i / 3) % 1;
      rings[i]!.scale.setScalar(1.15 + ph * 2.05);
      ringMats[i]!.color.copy(curColor);
      ringMats[i]!.opacity = (1 - ph) * (SEV_RANK[sev] >= 2 ? 0.6 : 0.35);
    }
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(tick);

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanup.forEach((f) => {
        try {
          f();
        } catch {
          /* ignore */
        }
      });
      const geos = new Set<T.BufferGeometry>();
      const mats = new Set<T.Material>();
      scene.traverse((obj) => {
        const m = obj as T.Mesh;
        if (m.geometry) geos.add(m.geometry);
        const mm = m.material as T.Material | T.Material[] | undefined;
        if (Array.isArray(mm)) mm.forEach((x) => mats.add(x));
        else if (mm) mats.add(mm);
      });
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      shadowTex.dispose();
      key.shadow.map?.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
