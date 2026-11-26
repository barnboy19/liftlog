// Interactive 3D anatomy figure for the Body tab (Three.js, via the import map in index.html).
// Loads models/muscles.glb, a sculpted muscle model adapted from Z-Anatomy / BodyParts3D
// (CC BY-SA 4.0; credits in models/LICENSE.md), colours it like an anatomy chart and makes
// each muscle group tappable.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = 'models/muscles.glb';

// Model region (glTF node name) → app muscle group id (js/muscles.js). Unlisted regions
// are shown in muscle colour but aren't tappable (neck, hands, feet).
const NODE_TO_MUSCLE = {
  pec_major_upper: 'chest', pec_major_lower: 'chest',
  anterior_delt: 'shoulders', lateral_delt: 'shoulders', posterior_delt: 'shoulders', rotator_cuff: 'shoulders',
  biceps: 'biceps', brachialis: 'biceps',
  triceps_lateral: 'triceps', triceps_long: 'triceps', triceps_medial: 'triceps',
  brachioradialis: 'forearms', forearm_extensors: 'forearms', forearm_flexors: 'forearms',
  rectus_abdominis: 'abs', transverse_abdominis: 'abs',
  obliques: 'obliques', serratus_anterior: 'obliques',
  upper_traps: 'traps', lower_traps: 'traps',
  mid_traps: 'upperback', rhomboids: 'upperback',
  upper_lats: 'lats', lower_lats: 'lats', teres_major: 'lats',
  erector_spinae: 'lowerback',
  glute_max: 'glutes', glute_med: 'glutes',
  hip_flexors: 'hipflexors',
  rectus_femoris: 'quads', vastus_group: 'quads',
  lateral_hamstrings: 'hamstrings', medial_hamstrings: 'hamstrings',
  adductors: 'adductors',
  gastrocnemius: 'calves', soleus: 'calves', tibialis_anterior: 'calves', fibularis: 'calves',
};

// Anatomy-chart palette: red muscle, pale tendon/bone, soft skin shell over hands and feet.
const COLORS = {
  muscle: 0xc0483c,
  head: 0xc65a4c,
  bone: 0xeadcc6,
  tendon: 0xf0e2cc,
  skin: 0xe8c4a8,
  selected: 0xd4ff3a, // app accent
};

export function mount(container, { onSelect, onProgress, onReady, onError } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x0b0d10, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';

  // Studio lighting: soft sky/ground fill, a key light that follows the camera, a cool rim from behind.
  scene.add(new THREE.HemisphereLight(0xfff4ec, 0x2a2224, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(1.2, 1.6, 2.5);
  camera.add(key);
  const rim = new THREE.DirectionalLight(0xbcd4ff, 0.9);
  rim.position.set(-2, 2, -3);
  scene.add(rim, camera);

  const disposables = [];
  const mat = (color, extra = {}) => {
    // DoubleSide: some parts (e.g. the mirrored half of the head) have inward-facing triangles.
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.0, vertexColors: true, side: THREE.DoubleSide, ...extra });
    disposables.push(m);
    return m;
  };
  const muscleMat = mat(COLORS.muscle);
  const contextMats = {
    body_context: mat(COLORS.head),
    context_bone: mat(COLORS.bone, { roughness: 0.75 }),
    context_tendon: mat(COLORS.tendon, { roughness: 0.5 }),
    context_skin: mat(COLORS.skin, { transparent: true, opacity: 0.55, depthWrite: false }), // alpha fades via vertex colour
  };
  const groupMats = new Map(); // muscle id → its own material, so one group can be highlighted
  const groupMat = (id) => {
    if (!groupMats.has(id)) groupMats.set(id, mat(COLORS.muscle));
    return groupMats.get(id);
  };

  const figure = new THREE.Group();
  scene.add(figure);

  // soft floor shadow
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const sctx = shadowCanvas.getContext('2d');
  const sg = sctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  sg.addColorStop(0, 'rgba(0,0,0,0.55)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = sg; sctx.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadowGeo = new THREE.PlaneGeometry(0.9, 0.9);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  disposables.push(shadowTex, shadowGeo, shadowMat);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.001;
  scene.add(shadow);

  // ---------- load the model ----------
  const meshesByMuscle = new Map();
  let disposed = false;
  new GLTFLoader().load(MODEL_URL, (gltf) => {
    if (disposed) return;
    const root = gltf.scene;
    // The file is centred at the origin, ~1.8 m tall; stand it on the floor.
    const box = new THREE.Box3().setFromObject(root);
    root.position.y -= box.min.y;
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      // A multi-part region loads as a group of meshes; the region name is on the nearest named node.
      let n = obj, region = null;
      while (n && !region) { if (NODE_TO_MUSCLE[n.name] || contextMats[n.name]) region = n.name; n = n.parent; }
      if (!region) { n = obj; while (n && n.parent && n.parent !== root) n = n.parent; region = n?.name; }
      const muscle = NODE_TO_MUSCLE[region];
      disposables.push(obj.geometry);
      if (muscle) {
        obj.material = groupMat(muscle);
        obj.userData.muscle = muscle;
        if (!meshesByMuscle.has(muscle)) meshesByMuscle.set(muscle, []);
        meshesByMuscle.get(muscle).push(obj);
      } else {
        obj.material = contextMats[region] || muscleMat; // neck, hands, feet: muscle colour, not tappable
        if (region === 'context_skin') obj.renderOrder = 2;
      }
    });
    figure.add(root);
    if (selected) select(selected);
    onReady?.();
  }, (ev) => {
    if (ev.lengthComputable) onProgress?.(ev.loaded / ev.total);
  }, (err) => onError?.(err));

  // ---------- camera & controls ----------
  const TARGET = new THREE.Vector3(0, 0.92, 0);
  const HOME = new THREE.Vector3(1.1, 1.25, 4.4);
  camera.position.copy(HOME);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;           // two-finger drag (or right-drag) moves the figure
  controls.screenSpacePanning = true;
  controls.minDistance = 0.6;
  controls.maxDistance = 6;
  controls.autoRotate = true;          // gentle spin until the first touch
  controls.autoRotateSpeed = 1.0;
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
    // Try the exact point, then a few nearby ones, so a tap on a seam between muscles still counts.
    for (const [dx, dy] of [[0, 0], [7, 0], [-7, 0], [0, 7], [0, -7], [12, 0], [-12, 0]]) {
      ndc.set(((e.clientX + dx - r.left) / r.width) * 2 - 1, -((e.clientY + dy - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      // First surface hit; skip the see-through skin shell over hands and feet.
      const hit = raycaster.intersectObject(figure, true).find((h) => h.object.material !== contextMats.context_skin);
      const id = hit?.object.userData.muscle;
      if (id) { onSelect?.(id); return; }
    }
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);

  let selected = null;
  const accent = new THREE.Color(COLORS.selected);
  function select(id) {
    if (selected && groupMats.has(selected)) {
      const m = groupMats.get(selected);
      m.color.setHex(COLORS.muscle); m.emissive.setHex(0x000000);
    }
    selected = id;
    if (id && groupMats.has(id)) {
      const m = groupMats.get(id);
      m.color.copy(accent); m.emissive.setHex(0x1c2400);
    }
  }

  // Animate the camera to look at the front, back, or the starting view.
  let anim = null;
  function view(which) {
    controls.autoRotate = false;
    const dist = camera.position.distanceTo(controls.target);
    const to = which === 'reset' ? HOME.clone() : new THREE.Vector3(0, TARGET.y + 0.15, which === 'back' ? -dist : dist);
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
    // Debug helpers: which muscle groups the model provides; render one frame as a PNG data URL.
    muscleIds: () => [...meshesByMuscle.keys()],
    snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
    dispose() {
      disposed = true;
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
