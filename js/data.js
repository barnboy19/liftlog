import { db, STORES } from './db.js';

// ---------- seed ----------
const SEED = {
  Chest: ['Bench Press', 'Incline Bench Press', 'Dumbbell Bench Press', 'Incline Dumbbell Press', 'Chest Fly', 'Dips', 'Push-up'],
  Back: ['Deadlift', 'Barbell Row', 'Dumbbell Row', 'Pull-up', 'Chin-up', 'Lat Pulldown', 'Seated Cable Row', 'T-Bar Row', 'Face Pull'],
  Legs: ['Squat', 'Front Squat', 'Leg Press', 'Romanian Deadlift', 'Bulgarian Split Squat', 'Lunge', 'Hip Thrust', 'Leg Extension', 'Leg Curl', 'Calf Raise'],
  Shoulders: ['Overhead Press', 'Dumbbell Shoulder Press', 'Lateral Raise', 'Rear Delt Fly', 'Shrug'],
  Arms: ['Barbell Curl', 'Dumbbell Curl', 'Hammer Curl', 'Preacher Curl', 'Tricep Pushdown', 'Skull Crusher', 'Overhead Tricep Extension'],
  Core: ['Hanging Leg Raise', 'Cable Crunch', 'Ab Wheel'],
};
export const CATEGORIES = [...Object.keys(SEED), 'Other'];

// Built-in exercises get stable ids so exports from two phones merge cleanly.
const slug = (s) => 'ex_' + s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export const nowIso = () => new Date().toISOString();

export async function ensureSeed() {
  if (await db.get('meta', 'seeded')) return;
  const createdAt = nowIso();
  const have = new Set((await db.all('exercises')).map((e) => e.id)); // never clobber renamed/imported ones
  const rows = [];
  for (const [category, names] of Object.entries(SEED))
    for (const name of names) if (!have.has(slug(name))) rows.push({ id: slug(name), name, category, createdAt, builtin: true });
  await db.putMany('exercises', rows);
  await db.put('meta', { key: 'seeded', value: true });
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
export const fmtSet = (s) => `${fmtW(dispW(s))} × ${s.reps}`;

// "185 × 8, 8, 6" — consecutive sets at the same weight collapse; weight changes split with " · ".
export function fmtSetsCompact(sets) {
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
  const [exercises, workouts, sets] = await Promise.all(['exercises', 'workouts', 'sets'].map((s) => db.all(s)));
  return { app: 'liftlog', schema: 1, exportedAt: nowIso(), settings: { ...settings }, exercises, workouts, sets };
}

export async function importJson(data) {
  if (!data || data.app !== 'liftlog' || !Array.isArray(data.sets) || !Array.isArray(data.workouts) || !Array.isArray(data.exercises))
    throw new Error("That file doesn't look like a LiftLog backup.");
  const ok = (r, keys) => r && typeof r.id === 'string' && keys.every((k) => k in r);
  const exercises = data.exercises.filter((r) => ok(r, ['name']));
  const workouts = data.workouts.filter((r) => ok(r, ['startedAt']));
  const sets = data.sets.filter((r) => ok(r, ['workoutId', 'exerciseId', 'weight', 'reps', 'loggedAt']))
    .map((r) => ({ unit: 'lb', order: 0, ...r }));
  await db.txn(['exercises', 'workouts', 'sets'], (s) => {
    exercises.forEach((r) => s.exercises.put(r));
    workouts.forEach((r) => s.workouts.put(r));
    sets.forEach((r) => s.sets.put(r));
  });
  if (data.settings) await saveSettings(data.settings);
  return { exercises: exercises.length, workouts: workouts.length, sets: sets.length };
}

export async function exportCsv() {
  const [ex, workouts, sets] = await Promise.all([exercisesMap(), db.all('workouts'), db.all('sets')]);
  const wo = new Map(workouts.map((w) => [w.id, w]));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['date', 'time', 'workout_started', 'exercise', 'category', 'set', 'weight', 'unit', 'reps', 'est_1rm', 'logged_at', 'workout_id']];
  sets.sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)).forEach((s) => {
    const d = new Date(s.loggedAt);
    const e = ex.get(s.exerciseId);
    rows.push([
      d.toLocaleDateString('en-CA'), d.toTimeString().slice(0, 5), wo.get(s.workoutId)?.startedAt ?? '',
      e?.name ?? s.exerciseId, e?.category ?? '', s.order + 1, s.weight, s.unit, s.reps,
      round1(e1rm(s.weight, s.reps)), s.loggedAt, s.workoutId,
    ]);
  });
  return rows.map((r) => r.map(q).join(',')).join('\n');
}

export async function eraseAll() {
  await db.txn(STORES, (s) => STORES.forEach((n) => s[n].clear()));
}
