import { db, STORES } from './db.js';

// ---------- seed ----------
const SEED = {
  Chest: ['Bench Press', 'Incline Bench Press', 'Dumbbell Bench Press', 'Incline Dumbbell Press', 'Chest Fly', 'Dips', 'Push-up'],
  Back: ['Deadlift', 'Barbell Row', 'Dumbbell Row', 'Pull-up', 'Chin-up', 'Lat Pulldown', 'Seated Cable Row', 'T-Bar Row', 'Face Pull'],
  Legs: ['Squat', 'Front Squat', 'Leg Press', 'Romanian Deadlift', 'Bulgarian Split Squat', 'Lunge', 'Hip Thrust', 'Leg Extension', 'Leg Curl', 'Calf Raise'],
  Shoulders: ['Overhead Press', 'Dumbbell Shoulder Press', 'Lateral Raise', 'Rear Delt Fly', 'Shrug'],
  Arms: ['Barbell Curl', 'Dumbbell Curl', 'Hammer Curl', 'Preacher Curl', 'Tricep Pushdown', 'Skull Crusher', 'Overhead Tricep Extension'],
  Core: ['Hanging Leg Raise', 'Cable Crunch', 'Ab Wheel', ['Plank', 'time'], ['Side Plank', 'time'], ['Dead Hang', 'time'], ['Wall Sit', 'time']],
  Cardio: [['Running', 'cardio'], ['Treadmill', 'cardio'], ['Walking', 'cardio'], ['Cycling', 'cardio'], ['Rowing Machine', 'cardio'],
    ['Stairmaster', 'time'], ['Elliptical', 'time'], ['Jump Rope', 'time']],
};
export const CATEGORIES = [...Object.keys(SEED), 'Other'];
const SEED_VERSION = 2; // bump when adding built-ins so existing installs get them

// Exercise types: how a set is recorded.
export const TYPES = {
  weight: 'Weight × reps',
  time: 'Time',
  cardio: 'Time + distance',
};
export const exType = (e) => e?.type || 'weight';
// Best guess for a new exercise's type from its name.
export function guessType(name) {
  const n = name.toLowerCase();
  if (/\b(run|jog|walk|bike|cycl|rowing|row machine|swim|treadmill|hike|sprint)/.test(n)) return 'cardio';
  if (/\b(plank|hang|hold|wall sit|stair|elliptical|rope|bike|carry|stretch|yoga|sauna)/.test(n)) return 'time';
  return 'weight';
}

// Built-in exercises get stable ids so exports from two phones merge cleanly.
const slug = (s) => 'ex_' + s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export const nowIso = () => new Date().toISOString();

export async function ensureSeed() {
  const seeded = (await db.get('meta', 'seeded'))?.value;
  if (seeded === SEED_VERSION) return;
  const createdAt = nowIso();
  const have = new Set((await db.all('exercises')).map((e) => e.id)); // never clobber renamed/imported ones
  const rows = [];
  for (const [category, items] of Object.entries(SEED))
    for (const item of items) {
      const [name, type = 'weight'] = Array.isArray(item) ? item : [item];
      if (!have.has(slug(name))) rows.push({ id: slug(name), name, category, type, createdAt, builtin: true });
    }
  await db.putMany('exercises', rows);
  await db.put('meta', { key: 'seeded', value: SEED_VERSION });
}

// ---------- settings ----------
const DEFAULT_SETTINGS = { unit: 'lb', stepLb: 5, stepKg: 2.5 };
export const settings = { ...DEFAULT_SETTINGS };
export async function loadSettings() {
  const row = await db.get('meta', 'settings');
  Object.assign(settings, DEFAULT_SETTINGS, row?.value || {});
}
export async function saveSettings(patch) {
  Object.assign(settings, patch);
  await db.put('meta', { key: 'settings', value: { ...settings } });
}
export const weightStep = () => (settings.unit === 'kg' ? settings.stepKg : settings.stepLb);

// ---------- units & formatting ----------
const LB_PER_KG = 2.20462262;
export function convert(w, from, to) {
  if (!w || from === to) return w;
  return from === 'kg' ? w * LB_PER_KG : w / LB_PER_KG;
}
const round1 = (n) => Math.round(n * 10) / 10;
// Weight of a stored set, expressed in the current display unit.
export const dispW = (set) => round1(convert(set.weight, set.unit, settings.unit));
export const fmtNum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
export const fmtW = (w) => (w === 0 ? 'BW' : fmtNum(w));
// ----- timed sets: duration in seconds, optional distance -----
export const isTimed = (s) => s.duration != null;
export const distUnit = () => (settings.unit === 'kg' ? 'km' : 'mi');
const KM_PER_MI = 1.609344;
export const dispDist = (s) => {
  if (!s.distance) return 0;
  const to = distUnit();
  const v = s.distUnit === to ? s.distance : (to === 'km' ? s.distance * KM_PER_MI : s.distance / KM_PER_MI);
  return Math.round(v * 100) / 100;
};
// 90 → "1:30", 3725 → "1:02:05"
export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
// "1:30" / "1.30" → 90 s, "1:02:05" → 3725 s. A bare number means minutes for cardio, seconds otherwise.
export function parseDur(text, bareIsMinutes = false) {
  const t = String(text).trim();
  if (!t) return 0;
  if (/[:.]/.test(t)) {
    const parts = t.split(/[:.]/).map((p) => parseInt(p, 10) || 0);
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  const n = parseFloat(t) || 0;
  return Math.round(bareIsMinutes ? n * 60 : n);
}
const fmtTimed = (s) => {
  const d = dispDist(s);
  return d ? `${fmtDur(s.duration)} · ${fmtNum(d)} ${distUnit()}` : fmtDur(s.duration);
};

export const fmtSet = (s) => (isTimed(s) ? fmtTimed(s) : `${fmtW(dispW(s))} × ${s.reps}`);

// "Score" used for PRs and bests: est. 1RM for lifts, distance (else time) for timed sets.
export const setScore = (s) => (isTimed(s) ? (dispDist(s) ? dispDist(s) * 100000 + s.duration : s.duration) : e1rm(dispW(s), s.reps));

// "185 × 8, 8, 6" — consecutive sets at the same weight collapse; weight changes split with " · ".
// Timed sets just list: "1:30, 1:15" or "25:00 · 3.1 mi".
export function fmtSetsCompact(sets) {
  if (sets.length && isTimed(sets[0])) return sets.map(fmtTimed).join(', ');
  const groups = [];
  for (const s of sets) {
    const w = dispW(s);
    const g = groups[groups.length - 1];
    if (g && g.w === w) g.reps.push(s.reps);
    else groups.push({ w, reps: [s.reps] });
  }
  return groups.map((g) => `${fmtW(g.w)} × ${g.reps.join(', ')}`).join(' · ');
}

export function fmtDate(iso, opts = {}) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), ...opts,
  });
}
export const fmtDay = (iso) => fmtDate(iso, { weekday: 'short' });
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
export const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();
export const dayKey = (iso) => new Date(iso).toDateString();

// ----- post-workout ratings -----
export const EFFORT_LABELS = ['', 'Very easy', 'Very easy', 'Easy', 'Easy', 'Moderate', 'Moderate', 'Hard', 'Hard', 'Very hard', 'Max effort'];
export const FEELINGS = [
  { emoji: '😫', label: 'Awful' },
  { emoji: '😕', label: 'Meh' },
  { emoji: '😐', label: 'OK' },
  { emoji: '🙂', label: 'Good' },
  { emoji: '💪', label: 'Great' },
];

// Epley: 1RM = w × (1 + reps/30). A single is its own 1RM.
export const e1rm = (w, reps) => (reps <= 1 ? w : w * (1 + reps / 30));

// ---------- queries ----------
const byOrder = (a, b) => (a.order - b.order) || a.loggedAt.localeCompare(b.loggedAt);

export async function exercisesMap() {
  const all = await db.all('exercises');
  return new Map(all.map((e) => [e.id, e]));
}
export async function workoutSets(workoutId) {
  return (await db.byIndex('sets', 'workoutId', workoutId)).sort(byOrder);
}
export async function exerciseSets(exerciseId) {
  return (await db.byIndex('sets', 'exerciseId', exerciseId)).sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
}
export async function allWorkouts() {
  return (await db.all('workouts')).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// Sets of an exercise grouped by workout, newest session first.
export async function exerciseSessions(exerciseId) {
  const sets = await exerciseSets(exerciseId);
  const map = new Map();
  for (const s of sets) {
    if (!map.has(s.workoutId)) map.set(s.workoutId, []);
    map.get(s.workoutId).push(s);
  }
  return [...map.entries()]
    .map(([workoutId, ss]) => ({ workoutId, sets: ss.sort(byOrder), date: ss[0].loggedAt }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// Most recently used exercise ids (walks the loggedAt index newest-first).
export async function recentExerciseIds(limit = 8) {
  const seen = new Set();
  let scanned = 0;
  await db.iterateDesc('sets', 'loggedAt', (s) => {
    seen.add(s.exerciseId);
    return seen.size < limit && ++scanned < 2000;
  });
  return [...seen];
}

// ---------- mutations ----------
export async function deleteWorkout(id) {
  const sets = await db.byIndex('sets', 'workoutId', id);
  await db.txn(['workouts', 'sets'], (s) => {
    s.workouts.delete(id);
    sets.forEach((x) => s.sets.delete(x.id));
  });
}
export async function deleteExercise(id) {
  const sets = await db.byIndex('sets', 'exerciseId', id);
  const workouts = await db.all('workouts');
  await db.txn(['exercises', 'sets', 'workouts'], (s) => {
    s.exercises.delete(id);
    sets.forEach((x) => s.sets.delete(x.id));
    workouts.filter((w) => w.exerciseOrder?.includes(id))
      .forEach((w) => s.workouts.put({ ...w, exerciseOrder: w.exerciseOrder.filter((e) => e !== id) }));
  });
}

// ---------- backup ----------
export async function exportJson() {
  const [exercises, workouts, sets, body, prs] = await Promise.all(['exercises', 'workouts', 'sets', 'body', 'prs'].map((s) => db.all(s)));
  return { app: 'liftlog', schema: 2, exportedAt: nowIso(), settings: { ...settings }, profile: await loadProfile(), exercises, workouts, sets, body, prs };
}

// ---------- body stats ----------
// profile: { heightCm }. body entries: { id, date, weight, unit, bodyFat, lenUnit, waist, chest, arms, thighs, hips, note }
export const MEASUREMENTS = [['waist', 'Waist'], ['chest', 'Chest'], ['arms', 'Arms'], ['thighs', 'Thighs'], ['hips', 'Hips']];
export async function loadProfile() { return (await db.get('meta', 'profile'))?.value || {}; }
export async function saveProfile(p) { await db.put('meta', { key: 'profile', value: p }); }
export async function bodyEntries() { return (await db.all('body')).sort((a, b) => b.date.localeCompare(a.date)); }
export const lenUnit = () => (settings.unit === 'kg' ? 'cm' : 'in');
export const dispLen = (v, from) => {
  if (!v) return 0;
  const to = lenUnit();
  return Math.round((from === to ? v : to === 'cm' ? v * 2.54 : v / 2.54) * 10) / 10;
};
export const dispBodyW = (e) => (e.weight ? Math.round(convert(e.weight, e.unit, settings.unit) * 10) / 10 : 0);
export function fmtHeight(cm) {
  if (!cm) return '—';
  if (settings.unit === 'kg') return `${Math.round(cm)} cm`;
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)}′${inches % 12}″`;
}
export function bmi(entry, profile) {
  if (!entry?.weight || !profile?.heightCm) return null;
  const kg = convert(entry.weight, entry.unit, 'kg');
  return Math.round((kg / (profile.heightCm / 100) ** 2) * 10) / 10;
}
export function bmiLabel(v) {
  if (v == null) return '';
  return v < 18.5 ? 'Underweight' : v < 25 ? 'Healthy range' : v < 30 ? 'Overweight' : 'Obese range';
}

// ---------- personal records ----------
// Best per exercise across logged sets and hand-entered PRs (same shape as a set).
export async function personalRecords() {
  const [sets, manual] = await Promise.all([db.all('sets'), db.all('prs')]);
  const best = new Map();
  for (const s of [...sets, ...manual]) {
    const cur = best.get(s.exerciseId);
    if (!cur || setScore(s) > setScore(cur) + 1e-9) best.set(s.exerciseId, s);
  }
  return best; // exerciseId -> best set-like record
}

export async function importJson(data) {
  if (!data || data.app !== 'liftlog' || !Array.isArray(data.sets) || !Array.isArray(data.workouts) || !Array.isArray(data.exercises))
    throw new Error("That file doesn't look like a LiftLog backup.");
  const ok = (r, keys) => r && typeof r.id === 'string' && keys.every((k) => k in r);
  const exercises = data.exercises.filter((r) => ok(r, ['name']));
  const workouts = data.workouts.filter((r) => ok(r, ['startedAt']));
  const sets = data.sets.filter((r) => ok(r, ['workoutId', 'exerciseId', 'weight', 'reps', 'loggedAt']))
    .map((r) => ({ unit: 'lb', order: 0, ...r }));
  // body / prs arrived in schema 2; older backups simply don't have them
  const body = (Array.isArray(data.body) ? data.body : []).filter((r) => ok(r, ['date']));
  const prs = (Array.isArray(data.prs) ? data.prs : []).filter((r) => ok(r, ['exerciseId', 'loggedAt']));
  await db.txn(['exercises', 'workouts', 'sets', 'body', 'prs'], (s) => {
    exercises.forEach((r) => s.exercises.put(r));
    workouts.forEach((r) => s.workouts.put(r));
    sets.forEach((r) => s.sets.put(r));
    body.forEach((r) => s.body.put(r));
    prs.forEach((r) => s.prs.put(r));
  });
  if (data.settings) await saveSettings(data.settings);
  if (data.profile && typeof data.profile === 'object') await saveProfile({ ...(await loadProfile()), ...data.profile });
  return { exercises: exercises.length, workouts: workouts.length, sets: sets.length, body: body.length, prs: prs.length };
}

export async function exportCsv() {
  const [ex, workouts, sets] = await Promise.all([exercisesMap(), db.all('workouts'), db.all('sets')]);
  const wo = new Map(workouts.map((w) => [w.id, w]));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['date', 'time', 'workout_started', 'exercise', 'category', 'set', 'weight', 'unit', 'reps', 'est_1rm',
    'duration_sec', 'duration', 'distance', 'distance_unit', 'workout_effort', 'workout_feeling', 'logged_at', 'workout_id']];
  sets.sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)).forEach((s) => {
    const d = new Date(s.loggedAt);
    const e = ex.get(s.exerciseId);
    const w = wo.get(s.workoutId);
    const timed = isTimed(s);
    rows.push([
      d.toLocaleDateString('en-CA'), d.toTimeString().slice(0, 5), w?.startedAt ?? '',
      e?.name ?? s.exerciseId, e?.category ?? '', s.order + 1,
      timed ? '' : s.weight, timed ? '' : s.unit, timed ? '' : s.reps, timed ? '' : round1(e1rm(s.weight, s.reps)),
      timed ? s.duration : '', timed ? fmtDur(s.duration) : '', s.distance || '', s.distance ? s.distUnit : '',
      w?.effort ?? '', w?.feeling ? FEELINGS[w.feeling - 1].label : '', s.loggedAt, s.workoutId,
    ]);
  });
  return rows.map((r) => r.map(q).join(',')).join('\n');
}

export async function eraseAll() {
  await db.txn(STORES, (s) => STORES.forEach((n) => s[n].clear()));
}
