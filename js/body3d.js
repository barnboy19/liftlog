// Interactive 3D muscle figure for the Body tab (Three.js, loaded via the import map in index.html).
// The figure is built from simple smooth shapes so there is no model file to download:
// a neutral "base" body plus one mesh (or mirrored pair) per muscle group, which can be tapped.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const COLORS = { base: 0x3a4352, muscle: 0xb4534b, selected: 0xd4ff3a, bg: 0x0b0d10 };

// [muscleId, center [x,y,z], radii [x,y,z], rotation z (radians, for the +x side), mirror?]
// Units are roughly metres; the figure is ~1.8 tall, facing +z.
const MUSCLE_SHAPES = [
  ['chest', [0.075, 1.36, 0.075], [0.085, 0.07, 0.036], 0.15, true],
  ['shoulders', [0.195, 1.425, 0.0], [0.062, 0.072, 0.066], 0, true],
  ['biceps', [0.222, 1.28, 0.03], [0.035, 0.088, 0.033], 0.13, true],
  ['triceps', [0.222, 1.28, -0.03], [0.036, 0.09, 0.034], 0.13, true],
  ['forearms', [0.248, 1.02, 0.018], [0.034, 0.1, 0.033], 0.1, true],
  ['abs', [0, 1.13, 0.082], [0.066, 0.145, 0.026], 0, false],
  ['obliques', [0.118, 1.1, 0.04], [0.035, 0.1, 0.056], -0.12, true],
  ['traps', [0, 1.47, -0.045], [0.115, 0.06, 0.042], 0, false],
  ['upperback', [0, 1.33, -0.08], [0.09, 0.08, 0.032], 0, false],
  ['lats', [0.112, 1.24, -0.058], [0.06, 0.14, 0.042], -0.22, true],
  ['lowerback', [0.036, 1.06, -0.076], [0.03, 0.1, 0.03], 0, true],
  ['glutes', [0.072, 0.925, -0.07], [0.076, 0.076, 0.056], 0, true],
  ['quads', [0.09, 0.7, 0.036], [0.061, 0.165, 0.046], 0.03, true],
  ['hamstrings', [0.09, 0.7, -0.036], [0.056, 0.16, 0.042], 0.03, true],
  ['adductors', [0.046, 0.76, 0.004], [0.03, 0.11, 0.04], 0.05, true],
  ['calves', [0.098, 0.33, -0.03], [0.043, 0.1, 0.041], 0.02, true],
];

export function mount(container, { onSelect } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.bg);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 30);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';

  // Lights: soft fill + a key light that rides with the camera so the side you look at is lit.
  scene.add(new THREE.HemisphereLight(0xdfe7f5, 0x1a1f28, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1.5, 2, 3);
  camera.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 0.6);
  rim.position.set(-2, 1, -3);
  scene.add(rim);
  scene.add(camera);

  // ---------- figure ----------
  const disposables = [];
  const sphere = new THREE.SphereGeometry(1, 40, 28);
  disposables.push(sphere);
  const baseMat = new THREE.MeshStandardMaterial({ color: COLORS.base, roughness: 0.75, metalness: 0.05 });
  disposables.push(baseMat);
  const figure = new THREE.Group();
  scene.add(figure);

  const blob = (mat, [x, y, z], [sx, sy, sz], rz = 0) => {
    const m = new THREE.Mesh(sphere, mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.z = rz;
    figure.add(m);
    return m;
  };
  const limb = (mat, a, b, r) => { // capsule from point a to point b
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new THREE.CapsuleGeometry(r, len, 8, 20);
    disposables.push(g);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    figure.add(m);
    return m;
  };
  const both = (fn) => { fn(1); fn(-1); };

  // base body
  blob(baseMat, [0, 1.665, 0.005], [0.085, 0.105, 0.095]);   // head
  limb(baseMat, [0, 1.5, -0.005], [0, 1.585, 0], 0.045);       // neck
  blob(baseMat, [0, 1.28, 0], [0.155, 0.25, 0.095]);           // torso
  blob(baseMat, [0, 0.965, 0], [0.142, 0.1, 0.09]);            // pelvis
  both((s) => {
    blob(baseMat, [0.19 * s, 1.43, 0], [0.05, 0.05, 0.05]);                            // shoulder joint
    limb(baseMat, [0.2 * s, 1.42, 0], [0.235 * s, 1.15, 0], 0.041);                     // upper arm
    limb(baseMat, [0.236 * s, 1.13, 0.005], [0.262 * s, 0.885, 0.02], 0.033);           // forearm
    blob(baseMat, [0.267 * s, 0.81, 0.025], [0.028, 0.058, 0.017]);                     // hand
    limb(baseMat, [0.085 * s, 0.92, 0], [0.095 * s, 0.52, 0.005], 0.062);               // thigh
    blob(baseMat, [0.095 * s, 0.5, 0.012], [0.045, 0.045, 0.045]);                      // knee
    limb(baseMat, [0.096 * s, 0.48, 0.005], [0.1 * s, 0.09, 0], 0.044);                 // shin
    blob(baseMat, [0.1 * s, 0.035, 0.035], [0.04, 0.03, 0.092]);                        // foot
  });

  // muscles
  const meshesByMuscle = new Map();
  const muscleMeshes = [];
  for (const [id, [x, y, z], r, rz, mirror] of MUSCLE_SHAPES) {
    const mat = new THREE.MeshStandardMaterial({ color: COLORS.muscle, roughness: 0.55, metalness: 0.05, emissive: 0x000000 });
    disposables.push(mat);
    const list = [blob(mat, [x, y, z], r, rz)];
    if (mirror) list.push(blob(mat, [-x, y, z], r, -rz));
    list.forEach((m) => { m.userData.muscle = id; muscleMeshes.push(m); });
    meshesByMuscle.set(id, { mat, list });
  }

  // soft floor shadow
  const shadowGeo = new THREE.CircleGeometry(0.42, 48);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 });
  disposables.push(shadowGeo, shadowMat);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.002;
  scene.add(shadow);

  // ---------- camera & controls ----------
  const TARGET = new THREE.Vector3(0, 0.9, 0);
  const HOME = new THREE.Vector3(1.15, 1.2, 4.6);
  camera.position.copy(HOME);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;           // two-finger drag (or right-drag) moves the figure
  controls.screenSpacePanning = true;
  controls.minDistance = 0.8;
  controls.maxDistance = 6;
  controls.autoRotate = true;          // gentle spin until the first touch
  controls.autoRotateSpeed = 1.2;
  controls.addEventListener('start', () => { controls.autoRotate = false; });
  controls.update();

  // ---------- tapping a muscle ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  const el = renderer.domElement;
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onUp = (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 500;
    down = null;
    if (moved > 8 || !quick) return; // that was a drag, not a tap
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(figure.children, false)[0];
    const id = hit?.object.userData.muscle;
    if (id) onSelect?.(id);
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);

  let selected = null;
  function select(id) {
    if (selected) meshesByMuscle.get(selected)?.mat.color.setHex(COLORS.muscle);
    if (selected) meshesByMuscle.get(selected)?.mat.emissive.setHex(0x000000);
    selected = id;
    const s = meshesByMuscle.get(id);
    if (s) { s.mat.color.setHex(COLORS.selected); s.mat.emissive.setHex(0x2a3300); }
  }

  // Animate the camera around to look at the front, back, or the starting view.
  let anim = null;
  function view(which) {
    controls.autoRotate = false;
    const dist = camera.position.distanceTo(controls.target);
    const to = which === 'reset' ? HOME.clone()
      : new THREE.Vector3(0, TARGET.y + 0.2, which === 'back' ? -dist : dist);
    anim = { from: camera.position.clone(), to, tFrom: controls.target.clone(), tTo: TARGET.clone(), start: performance.now(), dur: 450 };
  }

  // ---------- sizing & loop ----------
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let raf = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    if (anim) {
      const k = Math.min(1, (now - anim.start) / anim.dur);
      const e = 1 - (1 - k) ** 3;
      camera.position.lerpVectors(anim.from, anim.to, e);
      controls.target.lerpVectors(anim.tFrom, anim.tTo, e);
      if (k === 1) anim = null;
    }
    controls.update();
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  return {
    select,
    view,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      controls.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
