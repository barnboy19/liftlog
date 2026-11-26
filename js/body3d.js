// Interactive hologram-style muscle figure for the Body tab (Three.js, via the import map in index.html).
// The figure is built from smooth shapes in code (no model file to download): a translucent
// "base" body plus one mesh (or mirrored pair) per muscle group, which can be tapped.
// Look: additive, see-through glow with bright edges (fresnel), moving scan lines, a sweeping
// scan beam, a projector platform and drifting particles.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const HOLO = {
  base: new THREE.Color(0x2fb8ff),     // body shell
  muscle: new THREE.Color(0x52e3ff),   // muscle groups, a touch brighter and greener
  selected: new THREE.Color(0xd4ff3a), // app accent
};

// [muscleId, center [x,y,z], radii [x,y,z], rotation z (for the +x side), mirror?]
// Units are roughly metres; the figure is ~1.8 tall, facing +z.
const MUSCLE_SHAPES = [
  ['chest', [0.078, 1.36, 0.078], [0.088, 0.072, 0.038], 0.15, true],
  ['shoulders', [0.2, 1.425, 0.0], [0.066, 0.075, 0.07], 0, true],
  ['biceps', [0.228, 1.28, 0.032], [0.038, 0.09, 0.035], 0.13, true],
  ['triceps', [0.228, 1.28, -0.032], [0.04, 0.092, 0.036], 0.13, true],
  ['forearms', [0.255, 1.02, 0.018], [0.038, 0.105, 0.036], 0.1, true],
  ['abs', [0, 1.13, 0.08], [0.066, 0.145, 0.028], 0, false],
  ['obliques', [0.12, 1.1, 0.04], [0.038, 0.1, 0.058], -0.12, true],
  ['traps', [0, 1.47, -0.045], [0.118, 0.062, 0.044], 0, false],
  ['upperback', [0, 1.33, -0.082], [0.092, 0.082, 0.034], 0, false],
  ['lats', [0.115, 1.24, -0.058], [0.062, 0.145, 0.044], -0.22, true],
  ['lowerback', [0.037, 1.06, -0.074], [0.032, 0.1, 0.032], 0, true],
  ['glutes', [0.074, 0.925, -0.07], [0.08, 0.08, 0.06], 0, true],
  ['quads', [0.092, 0.7, 0.038], [0.066, 0.17, 0.05], 0.03, true],
  ['hamstrings', [0.092, 0.7, -0.038], [0.06, 0.165, 0.046], 0.03, true],
  ['adductors', [0.048, 0.76, 0.004], [0.033, 0.115, 0.044], 0.05, true],
  ['calves', [0.1, 0.33, -0.032], [0.048, 0.105, 0.046], 0.02, true],
];

// ---------- hologram shader ----------
const VERT = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vY;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vY = wp.y;
    vec4 mv = viewMatrix * wp;
    vView = normalize(-mv.xyz);
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uScan;
  uniform float uFill;   // how solid the inside looks
  uniform float uGlow;   // overall intensity
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vY;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float rim = pow(1.0 - facing, 2.4);                       // bright silhouette edges
    float lines = 0.72 + 0.28 * sin(vY * 260.0 - uTime * 5.0); // fine horizontal scan lines
    float beam = smoothstep(0.05, 0.0, abs(vY - uScan));       // sweeping scan beam
    float flicker = 0.95 + 0.05 * sin(uTime * 41.0 + vY * 3.0);
    float a = (uFill + rim * 1.1) * lines * flicker * uGlow + beam * 0.7;
    vec3 col = uColor * (0.55 + rim * 1.4) + beam * vec3(0.55, 1.0, 1.0);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0)); // additive blending scales by alpha
  }`;

export function mount(container, { onSelect } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 30);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x0b0d10, 1); // opaque: additive glow composites reliably everywhere
  container.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';

  const disposables = [];
  // Backdrop glow: a soft radial gradient on a plane fixed behind everything, riding with the camera.
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = bgCanvas.height = 256;
  const bctx = bgCanvas.getContext('2d');
  const bg = bctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  bg.addColorStop(0, 'rgba(47,184,255,0.22)');
  bg.addColorStop(0.55, 'rgba(47,184,255,0.06)');
  bg.addColorStop(1, 'rgba(47,184,255,0)');
  bctx.fillStyle = bg; bctx.fillRect(0, 0, 256, 256);
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  const bgGeo = new THREE.PlaneGeometry(9, 9);
  const bgMat = new THREE.MeshBasicMaterial({ map: bgTex, transparent: true, depthWrite: false, depthTest: false });
  disposables.push(bgTex, bgGeo, bgMat);
  const backdrop = new THREE.Mesh(bgGeo, bgMat);
  backdrop.position.set(0, -0.2, -12);
  backdrop.renderOrder = -1;
  camera.add(backdrop);
  scene.add(camera);
  const shared = { uTime: { value: 0 }, uScan: { value: 1 } };
  const holoMat = (color, fill, glow) => {
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { ...shared, uColor: { value: color.clone() }, uFill: { value: fill }, uGlow: { value: glow } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    disposables.push(m);
    return m;
  };

  // ---------- figure ----------
  const sphere = new THREE.SphereGeometry(1, 48, 32);
  disposables.push(sphere);
  const baseMat = holoMat(HOLO.base, 0.1, 1.0);
  const figure = new THREE.Group();
  scene.add(figure);

  // Depth pre-pass: an invisible copy of every shape writes depth first, so only the
  // front-most surface glows. Without it, every overlapping shape's outline shows through.
  // polygonOffset nudges the copies slightly back so the glowing surface always wins (no speckles).
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
  disposables.push(depthMat);
  const depthOnly = new THREE.Group();
  scene.add(depthOnly);
  const addShape = (m) => {
    m.renderOrder = 1;
    figure.add(m);
    const twin = new THREE.Mesh(m.geometry, depthMat);
    twin.position.copy(m.position); twin.quaternion.copy(m.quaternion); twin.scale.copy(m.scale);
    twin.renderOrder = 0;
    twin.raycast = () => {}; // taps go to the visible shape
    depthOnly.add(twin);
    return m;
  };
  const blob = (mat, [x, y, z], [sx, sy, sz], rz = 0) => {
    const m = new THREE.Mesh(sphere, mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.z = rz;
    return addShape(m);
  };
  const limb = (mat, a, b, r) => { // capsule from point a to point b
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const g = new THREE.CapsuleGeometry(r, va.distanceTo(vb), 10, 24);
    disposables.push(g);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    return addShape(m);
  };
  const both = (fn) => { fn(1); fn(-1); };

  // base body: fuller, tapered shapes so it reads as a body, not a stick figure
  blob(baseMat, [0, 1.665, 0.005], [0.086, 0.106, 0.096]);   // head
  blob(baseMat, [0, 1.6, 0.03], [0.06, 0.05, 0.06]);         // jaw
  limb(baseMat, [0, 1.49, -0.005], [0, 1.585, 0], 0.05);      // neck
  blob(baseMat, [0, 1.32, 0], [0.17, 0.2, 0.1]);              // rib cage (V-taper)
  blob(baseMat, [0, 1.1, 0], [0.135, 0.15, 0.088]);           // waist
  blob(baseMat, [0, 0.955, -0.005], [0.15, 0.105, 0.095]);    // pelvis
  both((s) => {
    blob(baseMat, [0.19 * s, 1.43, 0], [0.058, 0.058, 0.058]);                          // shoulder
    limb(baseMat, [0.2 * s, 1.42, 0], [0.237 * s, 1.15, 0], 0.046);                     // upper arm
    limb(baseMat, [0.238 * s, 1.13, 0.005], [0.264 * s, 0.885, 0.02], 0.038);           // forearm
    blob(baseMat, [0.269 * s, 0.81, 0.025], [0.03, 0.06, 0.019]);                       // hand
    limb(baseMat, [0.086 * s, 0.9, 0], [0.096 * s, 0.53, 0.005], 0.07);                 // thigh
    blob(baseMat, [0.096 * s, 0.5, 0.012], [0.05, 0.05, 0.05]);                         // knee
    limb(baseMat, [0.097 * s, 0.47, 0.005], [0.101 * s, 0.1, 0], 0.046);                // shin
    blob(baseMat, [0.101 * s, 0.035, 0.035], [0.042, 0.03, 0.095]);                     // foot
  });

  // muscles
  const meshesByMuscle = new Map();
  for (const [id, [x, y, z], r, rz, mirror] of MUSCLE_SHAPES) {
    const mat = holoMat(HOLO.muscle, 0.24, 1.1);
    const list = [blob(mat, [x, y, z], r, rz)];
    if (mirror) list.push(blob(mat, [-x, y, z], r, -rz));
    list.forEach((m) => { m.userData.muscle = id; });
    meshesByMuscle.set(id, { mat, list });
  }

  // ---------- projector platform, beam & particles ----------
  const fx = new THREE.Group();
  scene.add(fx);
  const glowMat = (color, opacity) => {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    disposables.push(m);
    return m;
  };
  const ring = (inner, outer, opacity, segs = 96) => {
    const g = new THREE.RingGeometry(inner, outer, segs);
    disposables.push(g);
    const m = new THREE.Mesh(g, glowMat(0x2fb8ff, opacity));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.002;
    fx.add(m);
    return m;
  };
  ring(0.34, 0.352, 0.9);
  ring(0.46, 0.465, 0.55);
  const dashed = ring(0.4, 0.43, 0.35, 24); // segmented ring spins
  dashed.material.wireframe = true;
  // soft disc of light under the feet
  const discCanvas = document.createElement('canvas');
  discCanvas.width = discCanvas.height = 128;
  const dctx = discCanvas.getContext('2d');
  const grd = dctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(70,200,255,0.55)');
  grd.addColorStop(1, 'rgba(70,200,255,0)');
  dctx.fillStyle = grd; dctx.fillRect(0, 0, 128, 128);
  const discTex = new THREE.CanvasTexture(discCanvas);
  const discGeo = new THREE.CircleGeometry(0.55, 64);
  const discMat = new THREE.MeshBasicMaterial({ map: discTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  disposables.push(discTex, discGeo, discMat);
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.001;
  fx.add(disc);
  // faint projection cone rising from the platform
  const coneGeo = new THREE.CylinderGeometry(0.42, 0.34, 1.95, 64, 1, true);
  const coneMat = glowMat(0x2fb8ff, 0.035);
  disposables.push(coneGeo);
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.y = 0.975;
  fx.add(cone);
  // drifting particles
  const N = 160;
  const pPos = new Float32Array(N * 3), pSpeed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, rad = 0.15 + Math.random() * 0.32;
    pPos[i * 3] = Math.cos(a) * rad; pPos[i * 3 + 1] = Math.random() * 1.9; pPos[i * 3 + 2] = Math.sin(a) * rad;
    pSpeed[i] = 0.05 + Math.random() * 0.12;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0x7fe6ff, size: 0.012, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
  disposables.push(pGeo, pMat);
  fx.add(new THREE.Points(pGeo, pMat));

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
    // The figure is see-through, so prefer the nearest muscle along the ray, not just the nearest surface.
    const hit = raycaster.intersectObjects(figure.children, false).find((h) => h.object.userData.muscle);
    if (hit) onSelect?.(hit.object.userData.muscle);
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);

  let selected = null;
  function select(id) {
    const prev = meshesByMuscle.get(selected);
    if (prev) { prev.mat.uniforms.uColor.value.copy(HOLO.muscle); prev.mat.uniforms.uFill.value = 0.24; prev.mat.uniforms.uGlow.value = 1.1; }
    selected = id;
    const s = meshesByMuscle.get(id);
    if (s) { s.mat.uniforms.uColor.value.copy(HOLO.selected); s.mat.uniforms.uFill.value = 0.5; }
  }

  // Animate the camera to look at the front, back, or the starting view.
  let anim = null;
  function view(which) {
    controls.autoRotate = false;
    const dist = camera.position.distanceTo(controls.target);
    const to = which === 'reset' ? HOME.clone() : new THREE.Vector3(0, TARGET.y + 0.2, which === 'back' ? -dist : dist);
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

  let raf = 0, last = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    shared.uTime.value = t;
    shared.uScan.value = 0.05 + ((t * 0.35) % 1) * 1.9;     // beam sweeps up the body
    if (selected) { // selected muscle pulses
      const s = meshesByMuscle.get(selected);
      if (s) s.mat.uniforms.uGlow.value = 1.05 + 0.25 * Math.sin(t * 5);
    }
    dashed.rotation.z += dt * 0.4;
    for (let i = 0; i < N; i++) {                            // particles drift up and wrap
      pPos[i * 3 + 1] += pSpeed[i] * dt;
      if (pPos[i * 3 + 1] > 1.95) pPos[i * 3 + 1] = 0;
    }
    pGeo.attributes.position.needsUpdate = true;
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
    // Debug helper: render one frame now and return it as a PNG data URL.
    snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
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
