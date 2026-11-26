import { db } from './db.js';
import {
  CATEGORIES, settings, ensureSeed, loadSettings, saveSettings, weightStep, uid, nowIso,
  convert, dispW, fmtNum, fmtW, fmtSet, fmtSetsCompact, fmtDate, fmtDay, fmtTime, fmtDuration, fmtClock,
  isToday, dayKey, e1rm, exercisesMap, workoutSets, allWorkouts, exerciseSessions, recentExerciseIds,
  deleteWorkout, deleteExercise, exportJson, importJson, exportCsv, eraseAll,
  TYPES, exType, guessType, isTimed, distUnit, dispDist, fmtDur, parseDur, setScore, EFFORT_LABELS, FEELINGS,
  MEASUREMENTS, loadProfile, saveProfile, bodyEntries, lenUnit, dispLen, dispBodyW, fmtHeight, bmi, bmiLabel, personalRecords,
} from './data.js';
import { MUSCLES, musclesById } from './muscles.js';

// ---------- tiny helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = () => $('#view');
const buzz = (p = 18) => { try { navigator.vibrate?.(p); } catch { /* unsupported */ } };
const unit = () => settings.unit;
const parseNum = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const roundTo = (n, step) => Math.round(n / step) * step;
const ss = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = {
  activeId: ss.get('activeWorkoutId'), // workout currently being logged (this app session)
  focusEx: null,                       // exercise card showing the logger
  drafts: {},                          // exerciseId -> { w, r } or { d, dist } pending values in the logger
  timer: null,                         // { exId, start } stopwatch for a timed exercise
  historyFilter: '',
  calMonth: null,                      // 'YYYY-MM' shown in the History calendar; null = this month
  exFilter: '',
};
const setActive = (id) => { state.activeId = id; ss.set('activeWorkoutId', id); };

// ---------- toast ----------
let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-action="toast-act">${esc(action.label)}</button>` : ''}`;
  el.classList.add('show');
  toast.action = action?.fn;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2200);
}

// ---------- sheets ----------
function openSheet(html, { tall = false } = {}) {
  $('#sheet-root').innerHTML =
    `<div class="backdrop" data-action="close-sheet"></div><div class="sheet ${tall ? 'tall' : ''}" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div>`;
  return $('#sheet-root .sheet');
}
const closeSheet = () => { $('#sheet-root').innerHTML = ''; };
function confirmSheet({ title, body = '', ok = 'OK', danger = false, cancel = 'Cancel' }) {
  return new Promise((resolve) => {
    openSheet(`<h2>${esc(title)}</h2>${body ? `<p class="muted">${body}</p>` : ''}
      <div class="stack"><button class="btn block ${danger ? 'danger' : 'primary'}" data-action="confirm-yes">${esc(ok)}</button>
      <button class="btn block ghost" data-action="close-sheet">${esc(cancel)}</button></div>`);
    confirmSheet.resolve = resolve;
  });
}

// ---------- router ----------
function route() {
  const [, name = 'workout', id] = (location.hash || '#/workout').split('/');
  return { name, id: id && decodeURIComponent(id) };
}
const TAB_FOR = {
  workout: 'workout', history: 'history', w: 'history', body: 'body',
  progress: 'progress', exercises: 'progress', e: 'progress', settings: 'settings',
};

let renderSeq = 0;
let body3d = null; // live 3D viewer while on the Body tab
async function render() {
  const seq = ++renderSeq;
  const r = route();
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === TAB_FOR[r.name]));
  const views = {
    workout: viewWorkout, history: viewHistory, w: viewWorkoutDetail, body: viewBody, progress: viewProgress,
    exercises: viewExercises, e: viewExercise, settings: viewSettings,
  };
  const html = await (views[r.name] || viewWorkout)(r.id);
  if (seq !== renderSeq) return; // a newer render started
  if (body3d && r.name !== 'body') { body3d.dispose(); body3d = null; }
  if (r.name === 'body' && body3d) return; // keep the running 3D scene; nothing to re-render
  view().classList.toggle('fill', r.name === 'body');
  view().innerHTML = html;
  afterRender[r.name]?.();
  tick();
}
const afterRender = {};

// ======================================================================
// WORKOUT
// ======================================================================
async function viewWorkout() {
  const workouts = await allWorkouts();
  const open = workouts.filter((w) => !w.endedAt);
  const active = open.find((w) => w.id === state.activeId);
  if (active) return viewActive(active);
  if (state.activeId) setActive(null);

  const today = open.find((w) => isToday(w.startedAt));
  const stale = open.filter((w) => !isToday(w.startedAt));
  const last = workouts.find((w) => w.endedAt);
  const now = new Date().toISOString();

  let main;
  if (today) {
    const sets = await workoutSets(today.id);
    const exCount = new Set([...(today.exerciseOrder || []), ...sets.map((s) => s.exerciseId)]).size;
    main = `<div class="card inprogress stack">
        <div><span class="pill">In progress</span></div>
        <div class="card-title">Started ${fmtTime(today.startedAt)}</div>
        <div class="muted">${exCount} exercise${exCount === 1 ? '' : 's'} · ${sets.length} set${sets.length === 1 ? '' : 's'}</div>
        <button class="btn primary xl block" data-action="continue" data-id="${today.id}">Continue Workout</button>
        <button class="btn block" data-action="finish-other" data-id="${today.id}">Finish it</button>
      </div>`;
  } else {
    main = `<button class="btn primary xl block" data-action="start">Start Workout</button>`;
  }

  const staleHtml = stale.map((w) => `<div class="card row">
      <div class="grow"><div><b>Unfinished workout</b></div><div class="muted small">${fmtDay(w.startedAt)} · ${fmtTime(w.startedAt)}</div></div>
      <button class="btn" data-action="finish-other" data-id="${w.id}">Finish</button></div>`).join('');

  let lastHtml = '';
  if (last) {
    const [sets, ex] = await Promise.all([workoutSets(last.id), exercisesMap()]);
    const names = [...new Set(sets.map((s) => ex.get(s.exerciseId)?.name).filter(Boolean))];
    lastHtml = `<h3>Last workout</h3>
      <a class="card" href="#/w/${last.id}">
        <div class="card-title">${fmtDay(last.startedAt)}</div>
        <div class="muted small">${fmtDuration(new Date(last.endedAt) - new Date(last.startedAt))} · ${sets.length} sets</div>
        <div class="small" style="margin-top:6px">${esc(names.join(', ') || 'No sets')}</div>
        ${ratingLine(last) ? `<div class="small muted" style="margin-top:4px">${ratingLine(last)}</div>` : ''}
      </a>`;
  }

  return `<section class="home-hero">
      <div class="date">${new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      <h1>${today ? 'Welcome back' : 'Ready to lift?'}</h1>
    </section>
    <div class="stack">${main}${staleHtml}</div>${lastHtml}`;
}

async function viewActive(w) {
  const [sets, ex] = await Promise.all([workoutSets(w.id), exercisesMap()]);
  const order = [...(w.exerciseOrder || [])];
  sets.forEach((s) => { if (!order.includes(s.exerciseId)) order.push(s.exerciseId); });
  if (!state.focusEx || !order.includes(state.focusEx)) state.focusEx = order[order.length - 1] || null;

  const histories = Object.fromEntries(await Promise.all(order.map(async (id) => [id, await exerciseSessions(id)])));
  const manualPrs = await db.all('prs');
  const lastSetAt = sets.length ? sets.reduce((a, s) => (s.loggedAt > a ? s.loggedAt : a), '') : null;

  const cards = order.map((exId) => {
    const e = ex.get(exId) || { name: 'Unknown exercise' };
    const mine = sets.filter((s) => s.exerciseId === exId);
    const prior = histories[exId].filter((h) => h.workoutId !== w.id);
    const prev = prior[0];
    const entered = manualPrs.filter((p) => p.exerciseId === exId);
    const priorBest = Math.max(0, ...prior.flatMap((h) => h.sets.map(setScore)), ...entered.map(setScore));
    // Flag the best set today if it beats everything before today (logged or entered by hand).
    let prId = null;
    if (prior.length || entered.length) {
      let best = priorBest;
      mine.forEach((s) => { const v = setScore(s); if (v > best + 0.01) { best = v; prId = s.id; } });
    }
    const focused = state.focusEx === exId;
    const type = exType(e);
    const d = draftFor(exId, mine, prev, type);
    const lastLine = prev
      ? `Last time: <b>${esc(fmtSetsCompact(prev.sets))}</b> (${fmtDate(prev.date)})`
      : 'First time doing this one';

    const rows = mine.map((s, i) => setRow(s, i, { pr: s.id === prId })).join('');
    const logger = focused
      ? loggerHtml(exId, type, d, mine.length, !!(mine.length || prev))
      : `<div class="collapsed-hint">${mine.length ? '' : 'No sets yet · '}Tap to log</div>`;

    return `<article class="ex-card ${focused ? 'focused' : ''}" data-ex="${exId}" ${focused ? '' : 'data-action="focus"'}>
        <div class="ex-head">
          <a class="ex-name linkish" href="#/e/${exId}">${esc(e.name)} <span class="chev">›</span></a>
          <span class="muted small">${mine.length} set${mine.length === 1 ? '' : 's'}</span>
          ${mine.length ? '' : `<button class="icon-btn" aria-label="Remove ${esc(e.name)}" data-action="remove-ex" data-ex="${exId}">×</button>`}
        </div>
        <div class="last">${lastLine}</div>
        ${rows ? `<ol class="sets">${rows}</ol>` : ''}
        ${logger}
      </article>`;
  }).join('');

  return `<header class="wo-head">
      <div class="grow" style="flex:1">
        <div class="timer" id="timer" data-start="${w.startedAt}">${fmtClock(Date.now() - new Date(w.startedAt))}</div>
        <div class="meta">Started ${fmtTime(w.startedAt)} · <span id="since" data-last="${lastSetAt || ''}">${sets.length} sets</span></div>
      </div>
      <button class="btn" data-action="finish">Finish</button>
    </header>
    ${cards || `<div class="empty">Add your first exercise to get going.</div>`}
    <button class="btn block ${order.length ? '' : 'primary xl'}" style="${order.length ? 'min-height:60px' : ''}" data-action="add-ex">＋ Add exercise</button>`;
}

function setRow(s, i, { pr = false, showTime = true } = {}) {
  const diffUnit = s.unit !== unit() && s.weight ? ` <small>(${fmtNum(s.weight)} ${s.unit})</small>` : '';
  return `<li class="set-wrap"><div class="set-row ${pr ? 'pr' : ''}" data-action="edit-set" data-set="${s.id}">
      <span class="n">${i + 1}</span><span class="wr">${fmtSet(s)}${diffUnit}</span>${showTime ? `<span class="t">${fmtTime(s.loggedAt)}</span>` : '<span></span>'}
    </div></li>`;
}

function stepperHtml(field, text, label, mode, placeholder = '', step = '') {
  const st = step ? ` data-step="${step}"` : '';
  return `<div class="stepper">
      <button data-action="step" data-field="${field}" data-dir="-1"${st} aria-label="Decrease ${label}">−</button>
      <div class="field"><label>${label}</label>
        <input data-field="${field}" inputmode="${mode}" enterkeyhint="done" autocomplete="off" value="${esc(text)}" placeholder="${placeholder}" aria-label="${label}"></div>
      <button data-action="step" data-field="${field}" data-dir="1"${st} aria-label="Increase ${label}">+</button>
    </div>`;
}
// Logger scopes that hold an in-progress set for the active workout (vs. edit/entry forms).
const isDraftScope = (s) => s && s !== 'edit' && s !== 'form';

// Input fields for one set, by exercise type. `kind` drives parsing and step sizes.
function fieldsHtml(type, d) {
  if (type === 'weight') return stepperHtml('w', fmtNum(d.w), `Weight · ${unit()}`, 'decimal') + stepperHtml('r', fmtNum(d.r), 'Reps', 'numeric');
  return stepperHtml('d', fmtDur(d.d), 'Time · m:ss', 'decimal')
    + (type === 'cardio' ? stepperHtml('dist', d.dist ? fmtNum(d.dist) : '', `Distance · ${distUnit()}`, 'decimal', 'optional') : '');
}

function loggerHtml(exId, type, d, nSets, canRepeat) {
  const running = state.timer?.exId === exId;
  const timerBtn = type === 'weight' ? '' : `<button class="btn block timer-btn ${running ? 'running' : ''}" data-action="timer" data-ex="${exId}">
      ${running ? `■ ${type === 'time' ? 'Stop &amp; log' : 'Stop'} <span id="sw">${fmtDur((Date.now() - state.timer.start) / 1000)}</span>` : '▶ Start timer'}</button>`;
  return `<div class="logger" data-scope="${exId}" data-kind="${type}">
      ${fieldsHtml(type, d)}
      ${timerBtn}
      <div class="actions">
        <button class="btn" data-action="repeat" data-ex="${exId}" ${canRepeat ? '' : 'disabled'}>↻ Repeat</button>
        <button class="btn primary" data-action="log" data-ex="${exId}">Log set ${nSets + 1}</button>
      </div>
    </div>`;
}

// Prefill: last set this workout → first set of the last session → defaults.
function draftFor(exId, mine, prev, type) {
  if (state.drafts[exId]) return state.drafts[exId];
  const src = mine[mine.length - 1] || prev?.sets[0];
  let d;
  if (type === 'weight') d = src && !isTimed(src) ? { w: roundTo(dispW(src), unit() === 'kg' ? 0.25 : 0.5), r: src.reps } : { w: 0, r: 8 };
  else d = src && isTimed(src) ? { d: src.duration, dist: dispDist(src) } : { d: type === 'time' ? 60 : 20 * 60, dist: 0 };
  state.drafts[exId] = d;
  return d;
}

function readScope(scopeEl) {
  const val = (f) => $(`input[data-field="${f}"]`, scopeEl)?.value;
  if (val('d') != null) {
    return {
      d: parseDur(val('d'), scopeEl.dataset.kind === 'cardio'),
      dist: Math.max(0, Math.round(parseNum(val('dist') ?? 0) * 100) / 100),
    };
  }
  return { w: Math.max(0, parseNum(val('w'))), r: Math.max(0, Math.round(parseNum(val('r')))) };
}

const setFromSource = (src) => (isTimed(src) ? { d: src.duration, dist: dispDist(src) } : { w: dispW(src), r: src.reps });

async function logSet(exId, vals) {
  const timed = 'd' in vals;
  if (timed ? !vals.d : !vals.r) { toast(timed ? 'Enter a time first' : 'Enter reps first'); return; }
  const wo = await db.get('workouts', state.activeId);
  if (!wo) return;
  const sets = await workoutSets(wo.id);
  const order = sets.filter((s) => s.exerciseId === exId).length;
  const base = { id: uid(), workoutId: wo.id, exerciseId: exId, unit: unit(), loggedAt: nowIso(), order };
  const set = timed
    ? { ...base, weight: 0, reps: 0, duration: vals.d, distance: vals.dist || null, distUnit: distUnit() }
    : { ...base, weight: vals.w, reps: vals.r };
  await db.put('sets', set);
  state.drafts[exId] = vals;
  buzz(20);
  await render();
  const row = $(`.set-row[data-set="${set.id}"]`);
  row?.classList.add('fresh');
  // keep the Log button under the thumb as the set list grows
  $('[data-action="log"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- exercise picker ----------
async function openPicker({ focus = true } = {}) {
  // Open + focus synchronously inside the tap so iOS shows the keyboard, then load data.
  const sheet = openSheet(`
      <div class="row"><h2 class="grow" style="margin:0">Add exercise</h2><button class="btn ghost" data-action="close-sheet">Close</button></div>
      <input class="search" id="pick-q" type="search" placeholder="Search or type a new name" autocomplete="off" enterkeyhint="go" style="margin-top:12px">
      <div class="scroll" id="pick-results"></div>`, { tall: true });
  const q = $('#pick-q', sheet);
  if (focus) q.focus();
  const [ex, recent, wo] = await Promise.all([exercisesMap(), recentExerciseIds(8), db.get('workouts', state.activeId)]);
  const inWorkout = new Set(wo?.exerciseOrder || []);
  const results = $('#pick-results', sheet);
  const all = [...ex.values()].sort((a, b) => a.name.localeCompare(b.name));
  const item = (e) => `<button class="list-item" data-action="pick" data-ex="${e.id}">
      <span class="grow"><b>${esc(e.name)}</b></span>${inWorkout.has(e.id) ? '<span class="tag">added</span>' : `<span class="tag">${esc(e.category || 'Other')}</span>`}</button>`;
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    if (!term) {
      const rec = recent.map((id) => ex.get(id)).filter(Boolean);
      const byCat = CATEGORIES.map((c) => [c, all.filter((e) => (e.category || 'Other') === c)]).filter(([, l]) => l.length);
      results.innerHTML =
        (rec.length ? `<h3>Recent</h3><div class="list">${rec.map(item).join('')}</div>` : '') +
        byCat.map(([c, l]) => `<h3>${esc(c)}</h3><div class="list">${l.map(item).join('')}</div>`).join('');
      return;
    }
    const score = (e) => {
      const n = e.name.toLowerCase();
      if (n === term) return 0;
      if (n.startsWith(term)) return 1;
      if (n.split(/[\s-]+/).some((w) => w.startsWith(term))) return 2;
      if (n.includes(term)) return 3;
      // every typed word appears somewhere ("row dumb" → "Dumbbell Row")
      return term.split(/\s+/).every((w) => n.includes(w)) ? 4 : 9;
    };
    const hits = all.map((e) => [score(e), e]).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).map(([, e]) => e);
    const exact = hits.some((e) => e.name.toLowerCase() === term);
    const guess = guessType(q.value);
    const create = exact ? '' : `<div class="create-box">
        <div class="small muted">＋ Create “<b style="color:var(--text)">${esc(q.value.trim())}</b>” as…</div>
        <div class="type-pick">${Object.entries(TYPES).map(([t, label]) =>
          `<button class="btn ${t === guess ? 'primary' : ''}" data-action="create-ex" data-type="${t}">${label}</button>`).join('')}</div>
      </div>`;
    results.innerHTML = hits.length ? `<div class="list" style="margin-top:12px">${hits.map(item).join('')}</div>${create}` : create;
  };
  q.addEventListener('input', draw);
  q.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    ($('#pick-results [data-action="pick"]', sheet) || $('#pick-results [data-action="create-ex"].primary', sheet))?.click();
  });
  draw();
}

async function addToWorkout(exId) {
  const wo = await db.get('workouts', state.activeId);
  if (!wo) return;
  wo.exerciseOrder = wo.exerciseOrder || [];
  if (!wo.exerciseOrder.includes(exId)) wo.exerciseOrder.push(exId);
  await db.put('workouts', wo);
  state.focusEx = exId;
  closeSheet();
  await render();
  $(`.ex-card[data-ex="${exId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------- edit set ----------
async function openEditSet(setId) {
  const s = await db.get('sets', setId);
  if (!s) return;
  const ex = await db.get('exercises', s.exerciseId);
  openSheet(`
    <h2>${esc(ex?.name || 'Set')}</h2>
    <div class="muted small" style="margin-bottom:12px">Logged ${fmtDay(s.loggedAt)} at ${fmtTime(s.loggedAt)}</div>
    ${(() => {
      const kind = isTimed(s) ? (s.distance || exType(ex) === 'cardio' ? 'cardio' : 'time') : 'weight';
      const d = isTimed(s) ? { d: s.duration, dist: dispDist(s) } : { w: dispW(s), r: s.reps };
      return `<div class="logger" data-scope="edit" data-kind="${kind}" style="border-radius:14px">${fieldsHtml(kind, d)}</div>`;
    })()}
    <div class="stack" style="margin-top:12px">
      <button class="btn primary block" data-action="save-set" data-set="${s.id}">Save</button>
      <button class="btn danger block" data-action="delete-set" data-set="${s.id}">Delete set</button>
      <button class="btn ghost block" data-action="close-sheet">Cancel</button>
    </div>`);
}

async function removeSet(setId) {
  const s = await db.get('sets', setId);
  if (!s) return;
  await db.del('sets', setId);
  // keep "order" contiguous for that exercise in that workout
  const rest = (await workoutSets(s.workoutId)).filter((x) => x.exerciseId === s.exerciseId);
  await db.putMany('sets', rest.map((x, i) => ({ ...x, order: i })));
  buzz(10);
  closeSheet();
  await render();
  toast('Set deleted', { label: 'Undo', fn: async () => { await db.put('sets', s); await render(); } });
}

// ---------- finishing ----------
async function finishWorkout(id) {
  const wo = await db.get('workouts', id);
  if (!wo) return;
  const sets = await workoutSets(id);
  if (!sets.length) {
    const ok = await confirmSheet({ title: 'No sets logged', body: 'Discard this empty workout?', ok: 'Discard workout', danger: true });
    if (!ok) return;
    await deleteWorkout(id);
    if (state.activeId === id) setActive(null);
    return render();
  }
  const exCount = new Set(sets.map((s) => s.exerciseId)).size;
  // An old unfinished workout ends at its last set, not "now".
  const endedAt = isToday(wo.startedAt) ? nowIso() : sets[sets.length - 1].loggedAt;
  const dur = fmtDuration(new Date(endedAt) - new Date(wo.startedAt));
  const ok = await confirmSheet({ title: 'Finish workout?', body: `${exCount} exercises · ${sets.length} sets · ${dur}`, ok: 'Finish workout', cancel: 'Keep going' });
  if (!ok) return;
  wo.endedAt = endedAt;
  await db.put('workouts', wo);
  if (state.activeId === id) setActive(null);
  state.drafts = {};
  buzz([20, 60, 20]);
  openSheet(`
    <div class="muted" style="text-align:center;margin-top:8px">Workout complete</div>
    <div class="big-num">${dur}</div>
    <div class="muted" style="text-align:center">${fmtTime(wo.startedAt)} – ${fmtTime(endedAt)}</div>
    <div class="stats">
      <div class="stat"><div class="k">Exercises</div><div class="v">${exCount}</div></div>
      <div class="stat"><div class="k">Sets</div><div class="v">${sets.length}</div></div>
      ${totalsHtml(sets)}
    </div>
    ${ratingHtml(wo)}
    <div class="stack" style="margin-top:20px">
      <a class="btn block" href="#/w/${id}" data-action="close-sheet">View details</a>
      <button class="btn primary block" data-action="close-sheet">Done</button>
    </div>`);
  await render();
}

// Volume for lifts, total time for timed sets — whichever the workout has.
function totalsHtml(sets) {
  const volume = sets.reduce((a, s) => a + (isTimed(s) ? 0 : dispW(s) * s.reps), 0);
  const secs = sets.reduce((a, s) => a + (isTimed(s) ? s.duration : 0), 0);
  const dist = sets.reduce((a, s) => a + (isTimed(s) ? dispDist(s) : 0), 0);
  const tiles = [];
  if (volume) tiles.push(`<div class="stat"><div class="k">Volume</div><div class="v">${Math.round(volume).toLocaleString()} <small>${unit()}</small></div></div>`);
  if (secs) tiles.push(`<div class="stat"><div class="k">Timed work</div><div class="v">${fmtDur(secs)}${dist ? ` <small>${fmtNum(Math.round(dist * 100) / 100)} ${distUnit()}</small>` : ''}</div></div>`);
  if (tiles.length === 1) tiles[0] = tiles[0].replace('class="stat"', 'class="stat" style="grid-column:span 2"');
  return tiles.join('');
}

// ---------- effort & feeling ratings ----------
const effortCaption = (n) => (n ? `${n}/10 · ${EFFORT_LABELS[n]}` : '1 = very easy · 10 = all-out');
function ratingHtml(w) {
  return `<div class="rating" data-wid="${w.id}">
      <h3>Effort</h3>
      <div class="rate-grid">${Array.from({ length: 10 }, (_, i) => i + 1).map((n) =>
        `<button class="${w.effort === n ? 'on' : ''}" data-action="rate" data-k="effort" data-v="${n}" aria-label="Effort ${n} of 10">${n}</button>`).join('')}</div>
      <div class="rate-caption" data-cap="effort">${effortCaption(w.effort)}</div>
      <h3>How did you feel?</h3>
      <div class="feel-grid">${FEELINGS.map((f, i) =>
        `<button class="${w.feeling === i + 1 ? 'on' : ''}" data-action="rate" data-k="feeling" data-v="${i + 1}"><span class="emo">${f.emoji}</span>${f.label}</button>`).join('')}</div>
    </div>`;
}
function ratingLine(w) {
  const bits = [];
  if (w.effort) bits.push(`Effort ${w.effort}/10`);
  if (w.feeling) bits.push(`${FEELINGS[w.feeling - 1].emoji} ${FEELINGS[w.feeling - 1].label}`);
  return bits.join(' · ');
}

// ======================================================================
// HISTORY
// ======================================================================
async function viewHistory() {
  const mode = histMode();
  return `<h1>History</h1>
    <div class="seg" style="margin-bottom:12px">
      <button class="${mode === 'list' ? 'on' : ''}" data-action="hist-mode" data-m="list">List</button>
      <button class="${mode === 'calendar' ? 'on' : ''}" data-action="hist-mode" data-m="calendar">Calendar</button>
    </div>
    ${mode === 'calendar' ? '<div id="cal"></div>' : `
    <input class="search" id="hist-q" type="search" placeholder="Filter by exercise" value="${esc(state.historyFilter)}" autocomplete="off">
    <div id="hist-list"></div>`}`;
}
afterRender.history = () => {
  if (histMode() === 'calendar') return drawCalendar();
  const q = $('#hist-q');
  q.addEventListener('input', () => { state.historyFilter = q.value; drawHistory(); });
  drawHistory();
};
const histMode = () => (ls.get('historyMode') === 'calendar' ? 'calendar' : 'list');

// ---------- calendar ----------
// Each workout day is labelled by the muscles it trained most. A set counts for every
// muscle its exercise works (same exercise-to-muscle mapping as the Body tab).
const GROUPS = [
  { id: 'push', name: 'Push', color: '#ff8a3d', muscles: ['chest', 'shoulders', 'triceps'] },
  { id: 'pull', name: 'Pull', color: '#3987e5', muscles: ['lats', 'upperback', 'biceps', 'traps', 'forearms', 'lowerback'] },
  { id: 'legs', name: 'Legs', color: '#b07cff', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'hipflexors'] },
  { id: 'core', name: 'Core', color: '#2ec4b6', muscles: ['abs', 'obliques'] },
];
const GROUP_OF = Object.fromEntries(GROUPS.flatMap((g) => g.muscles.map((m) => [m, g])));
const MIXED = { upper: { name: 'Upper body', color: '#e5c339' }, full: { name: 'Full body', color: '#d4ff3a' }, other: { name: 'Workout', color: '#8a94a3' } };
const localDay = (iso) => new Date(iso).toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

function musclesForExercises(ex) { // exerciseId -> [muscleId]
  const idx = new Map();
  const add = (exId, m) => { if (!idx.has(exId)) idx.set(exId, []); if (!idx.get(exId).includes(m)) idx.get(exId).push(m); };
  for (const m of MUSCLES) {
    m.exercises.forEach((id) => ex.has(id) && add(id, m.id));
    for (const e of ex.values()) if (!e.builtin && m.match?.test(e.name) && !m.exclude?.test(e.name)) add(e.id, m.id);
  }
  return idx;
}

// Summarise a list of sets: muscle scores, the day's label and its colour.
function summarizeSets(sets, idx) {
  const score = new Map();
  for (const s of sets) {
    const ms = idx.get(s.exerciseId);
    if (!ms?.length) continue;
    ms.forEach((m) => score.set(m, (score.get(m) || 0) + 1));
  }
  const total = [...score.values()].reduce((a, b) => a + b, 0);
  const muscles = [...score].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, name: musclesById[id].name, n, share: n / total }));
  if (!total) return { muscles, total, kind: MIXED.other, top: null };
  const byGroup = new Map();
  muscles.forEach((m) => { const g = GROUP_OF[m.id]; byGroup.set(g, (byGroup.get(g) || 0) + m.n); });
  const [[topGroup, topN]] = [...byGroup].sort((a, b) => b[1] - a[1]);
  let kind = topGroup;
  if (topN / total < 0.6) {
    const upper = (byGroup.get(GROUPS[0]) || 0) + (byGroup.get(GROUPS[1]) || 0);
    kind = upper / total >= 0.75 ? MIXED.upper : MIXED.full;
  }
  return { muscles, total, kind, top: muscles[0] };
}

async function calendarData() {
  const [workouts, ex, sets] = await Promise.all([allWorkouts(), exercisesMap(), db.all('sets')]);
  const idx = musclesForExercises(ex);
  const wDay = new Map(workouts.map((w) => [w.id, localDay(w.startedAt)]));
  const days = new Map(); // YYYY-MM-DD -> { workouts: [], sets: [] }
  const day = (k) => { if (!days.has(k)) days.set(k, { workouts: [], sets: [] }); return days.get(k); };
  workouts.forEach((w) => day(wDay.get(w.id)).workouts.push(w));
  sets.forEach((s) => { const k = wDay.get(s.workoutId); if (k) day(k).sets.push(s); });
  return { days, idx, ex };
}

async function drawCalendar() {
  const now = new Date();
  const thisMonth = now.toLocaleDateString('en-CA').slice(0, 7);
  const ym = state.calMonth || thisMonth;
  const [y, mo] = ym.split('-').map(Number);
  const { days, idx } = await calendarData();
  const first = new Date(y, mo - 1, 1);
  const nDays = new Date(y, mo, 0).getDate();
  const today = localDay(now.toISOString());
  const weekdays = [...Array(7)].map((_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: 'narrow' }));

  let cells = '';
  for (let i = 0; i < first.getDay(); i++) cells += '<div class="cal-cell empty"></div>';
  const monthSets = [];
  let nWorkoutDays = 0;
  for (let d = 1; d <= nDays; d++) {
    const key = `${ym}-${String(d).padStart(2, '0')}`;
    const info = days.get(key);
    const cls = `cal-cell${key === today ? ' today' : ''}`;
    if (!info) { cells += `<div class="${cls}"><span class="cal-num">${d}</span></div>`; continue; }
    nWorkoutDays++;
    monthSets.push(...info.sets);
    const sum = summarizeSets(info.sets, idx);
    const label = sum.top ? sum.muscles.slice(0, 2).map((m) => m.name).join(', ') : sum.kind.name;
    cells += `<button class="${cls} done" style="--c:${sum.kind.color}" data-action="cal-day" data-d="${key}"
        aria-label="${esc(first.toLocaleDateString(undefined, { month: 'long' }))} ${d}: ${esc(sum.kind.name)}, mostly ${esc(label)}">
        <span class="cal-num">${d}</span><span class="cal-tag">${esc(sum.kind.name.replace(' body', ''))}</span></button>`;
  }

  const month = summarizeSets(monthSets, idx);
  const usedKinds = new Map();
  for (const [k, info] of days) if (k.startsWith(ym)) { const s = summarizeSets(info.sets, idx); usedKinds.set(s.kind.name, s.kind.color); }
  const legend = [...usedKinds].map(([n, c]) => `<span class="cal-key"><i style="background:${c}"></i>${esc(n)}</span>`).join('');

  $('#cal').innerHTML = `
    <div class="row cal-head">
      <button class="btn ghost" data-action="cal-move" data-step="-1" aria-label="Previous month">‹</button>
      <div class="grow cal-title">${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
      <button class="btn ghost" data-action="cal-move" data-step="1" aria-label="Next month" ${ym >= thisMonth ? 'disabled' : ''}>›</button>
    </div>
    <div class="cal-grid">${weekdays.map((w) => `<div class="cal-wd">${w}</div>`).join('')}${cells}</div>
    ${legend ? `<div class="cal-legend">${legend}</div>` : ''}
    <div class="card" style="margin-top:12px">
      ${nWorkoutDays
        ? `<div class="card-title">${nWorkoutDays} workout day${nWorkoutDays === 1 ? '' : 's'}</div>
           ${month.muscles.length ? `<div class="muted small">Most trained: ${month.muscles.slice(0, 3).map((m) => esc(m.name)).join(', ')}</div>
           ${muscleBars(month.muscles.slice(0, 6))}` : ''}`
        : '<div class="muted">No workouts this month.</div>'}
    </div>
    ${ym !== thisMonth ? '<button class="btn block" data-action="cal-move" data-step="0" style="margin-top:12px">Back to this month</button>' : ''}`;
}

function muscleBars(muscles) {
  const max = muscles[0]?.n || 1;
  return `<div class="cal-bars">${muscles.map((m) => `
    <div class="cal-bar"><span>${esc(m.name)}</span>
      <div class="cal-track"><i style="width:${Math.round((m.n / max) * 100)}%;background:${GROUP_OF[m.id].color}"></i></div>
      <b>${m.n}</b></div>`).join('')}</div>`;
}

async function openCalendarDay(key) {
  const { days, idx, ex } = await calendarData();
  const info = days.get(key);
  if (!info) return;
  const sum = summarizeSets(info.sets, idx);
  const date = new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const cards = info.workouts.map((w) => {
    const ws = info.sets.filter((s) => s.workoutId === w.id);
    const names = [...new Set(ws.map((s) => ex.get(s.exerciseId)?.name).filter(Boolean))];
    return `<a class="card" href="#/w/${w.id}" data-action="close-sheet">
      <div class="card-title">${fmtTime(w.startedAt)}${w.endedAt ? ` – ${fmtTime(w.endedAt)}` : ''}</div>
      <div class="muted small">${ws.length} set${ws.length === 1 ? '' : 's'} · ${names.map(esc).join(', ') || 'No sets'}</div></a>`;
  }).join('');
  openSheet(`
    <div class="row"><h2 class="grow" style="margin:0">${esc(date)}</h2><button class="btn ghost" data-action="close-sheet">Close</button></div>
    <div style="margin-top:6px"><span class="pill" style="background:${sum.kind.color}">${esc(sum.kind.name)}</span>
      ${sum.muscles.length ? `<span class="muted small">&nbsp;mostly ${sum.muscles.slice(0, 3).map((m) => esc(m.name)).join(', ')}</span>` : ''}</div>
    ${sum.muscles.length ? `<h3>Sets per muscle</h3>${muscleBars(sum.muscles)}` : '<p class="muted small">None of these exercises map to a muscle group yet.</p>'}
    <h3>Workouts</h3>${cards}`, { tall: true });
}
async function drawHistory() {
  const [workouts, ex, sets] = await Promise.all([allWorkouts(), exercisesMap(), db.all('sets')]);
  const byW = new Map();
  sets.forEach((s) => { if (!byW.has(s.workoutId)) byW.set(s.workoutId, []); byW.get(s.workoutId).push(s); });
  const term = state.historyFilter.trim().toLowerCase();
  let html = '', lastDay = '';
  let shown = 0;
  for (const w of workouts) {
    const ws = byW.get(w.id) || [];
    const names = [];
    ws.sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)).forEach((s) => {
      const n = ex.get(s.exerciseId)?.name; if (n && !names.includes(n)) names.push(n);
    });
    if (term && !names.some((n) => n.toLowerCase().includes(term))) continue;
    shown++;
    const dk = dayKey(w.startedAt);
    if (dk !== lastDay) { html += `<h3>${new Date(w.startedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</h3>`; lastDay = dk; }
    const dur = w.endedAt ? fmtDuration(new Date(w.endedAt) - new Date(w.startedAt)) : 'in progress';
    const shownNames = term ? names.map((n) => (n.toLowerCase().includes(term) ? `<b>${esc(n)}</b>` : esc(n))) : names.map(esc);
    html += `<a class="card" href="#/w/${w.id}">
        <div class="row"><div class="grow card-title">${fmtTime(w.startedAt)}${w.endedAt ? ` – ${fmtTime(w.endedAt)}` : ''}</div>
        ${w.endedAt ? '' : '<span class="pill">Open</span>'}</div>
        <div class="muted small">${dur} · ${ws.length} set${ws.length === 1 ? '' : 's'} · ${names.length} exercise${names.length === 1 ? '' : 's'}</div>
        <div class="small" style="margin-top:6px;color:var(--text-2)">${shownNames.join(', ') || 'No sets'}</div>
        ${ratingLine(w) ? `<div class="small muted" style="margin-top:4px">${ratingLine(w)}</div>` : ''}
      </a>`;
  }
  $('#hist-list').innerHTML = shown ? html
    : `<div class="empty">${term ? 'No workouts with that exercise.' : 'No workouts yet. Start one from the Workout tab.'}</div>`;
}

async function viewWorkoutDetail(id) {
  const w = await db.get('workouts', id);
  if (!w) return `<p class="empty">Workout not found.</p><a class="btn block" href="#/history">Back to history</a>`;
  const [sets, ex] = await Promise.all([workoutSets(id), exercisesMap()]);
  const groups = [];
  sets.forEach((s) => {
    let g = groups.find((x) => x.exId === s.exerciseId);
    if (!g) groups.push((g = { exId: s.exerciseId, sets: [] }));
    g.sets.push(s);
  });
  const dur = w.endedAt ? fmtDuration(new Date(w.endedAt) - new Date(w.startedAt)) : '—';
  return `<button class="btn ghost" data-action="back" data-fallback="#/history" style="margin-left:-12px">‹ History</button>
    <h1>${new Date(w.startedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h1>
    <div class="muted">${fmtTime(w.startedAt)}${w.endedAt ? ` – ${fmtTime(w.endedAt)}` : ' · in progress'}</div>
    <div class="stats">
      <div class="stat"><div class="k">Duration</div><div class="v">${dur}</div></div>
      <div class="stat"><div class="k">Sets</div><div class="v">${sets.length}</div></div>
      ${totalsHtml(sets)}
    </div>
    ${w.endedAt ? '' : `<button class="btn primary block" data-action="continue" data-id="${w.id}" style="margin-bottom:12px">Continue this workout</button>`}
    ${groups.map((g) => `<div class="ex-card">
        <div class="ex-head"><a class="ex-name linkish" href="#/e/${g.exId}">${esc(ex.get(g.exId)?.name || 'Unknown')} <span class="chev">›</span></a></div>
        <ol class="sets">${g.sets.map((s, i) => setRow(s, i)).join('')}</ol></div>`).join('') || '<div class="empty">No sets in this workout.</div>'}
    ${w.endedAt ? ratingHtml(w) : ''}
    <h3>Notes</h3>
    <textarea class="notes" id="wo-notes" data-id="${w.id}" placeholder="How did it feel?">${esc(w.notes || '')}</textarea>
    <button class="btn danger block" data-action="delete-workout" data-id="${w.id}" style="margin-top:20px">Delete workout</button>`;
}
afterRender.w = () => {
  const t = $('#wo-notes');
  t?.addEventListener('change', async () => {
    const w = await db.get('workouts', t.dataset.id);
    if (w) { w.notes = t.value; await db.put('workouts', w); toast('Notes saved'); }
  });
};

// ======================================================================
// EXERCISES
// ======================================================================
async function viewExercises() {
  return `<button class="btn ghost" data-action="back" data-fallback="#/progress" style="margin-left:-12px">‹ Progress</button>
    <div class="row"><h1 class="grow">Exercises</h1><button class="btn" data-action="new-ex">＋ New</button></div>
    <input class="search" id="ex-q" type="search" placeholder="Search exercises" value="${esc(state.exFilter)}" autocomplete="off">
    <div id="ex-list"></div>`;
}
afterRender.exercises = () => {
  const q = $('#ex-q');
  q.addEventListener('input', () => { state.exFilter = q.value; drawExercises(); });
  drawExercises();
};
async function drawExercises() {
  const [ex, sets] = await Promise.all([exercisesMap(), db.all('sets')]);
  const stats = new Map();
  sets.forEach((s) => {
    const st = stats.get(s.exerciseId) || { n: 0, last: '' };
    st.n++; if (s.loggedAt > st.last) st.last = s.loggedAt;
    stats.set(s.exerciseId, st);
  });
  const term = state.exFilter.trim().toLowerCase();
  const all = [...ex.values()].filter((e) => !term || e.name.toLowerCase().includes(term)).sort((a, b) => a.name.localeCompare(b.name));
  const html = CATEGORIES.map((c) => {
    const l = all.filter((e) => (e.category || 'Other') === c);
    if (!l.length) return '';
    return `<h3>${esc(c)}</h3><div class="list">${l.map((e) => {
      const st = stats.get(e.id);
      return `<a class="list-item" href="#/e/${e.id}"><span class="grow"><b>${esc(e.name)}</b>
        <div class="sub">${st ? `${st.n} sets · last ${fmtDate(st.last)}` : 'Not logged yet'}</div></span><span class="chev">›</span></a>`;
    }).join('')}</div>`;
  }).join('');
  $('#ex-list').innerHTML = html || `<div class="empty">No match.<br><br><button class="btn primary" data-action="new-ex">＋ Create “${esc(state.exFilter.trim())}”</button></div>`;
}

function openExerciseForm(e = null, presetName = '') {
  openSheet(`<h2>${e ? 'Edit exercise' : 'New exercise'}</h2>
    <div class="stack">
      <input class="text" id="exf-name" placeholder="Name" value="${esc(e?.name || presetName)}" autocomplete="off">
      <select class="text" id="exf-cat">${CATEGORIES.map((c) => `<option ${((e?.category || 'Other') === c) ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <div class="small muted">How is a set recorded?</div>
      <div class="seg" id="exf-type">${Object.entries(TYPES).map(([t, label]) =>
        `<button class="${(e ? exType(e) : guessType(presetName)) === t ? 'on' : ''}" data-action="pick-type" data-type="${t}">${label}</button>`).join('')}</div>
      <button class="btn primary block" data-action="save-ex" data-id="${e?.id || ''}">Save</button>
      ${e ? `<button class="btn danger block" data-action="delete-ex" data-id="${e.id}">Delete exercise</button>` : ''}
      <button class="btn ghost block" data-action="close-sheet">Cancel</button>
    </div>`);
  $('#exf-name').focus();
}

async function createExercise(name, category = 'Other', type = 'weight') {
  name = name.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  const existing = (await db.all('exercises')).find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const e = { id: uid(), name, category, type, createdAt: nowIso() };
  await db.put('exercises', e);
  return e;
}

async function viewExercise(id) {
  const e = await db.get('exercises', id);
  if (!e) return `<p class="empty">Exercise not found.</p><a class="btn block" href="#/exercises">All exercises</a>`;
  const sessions = await exerciseSessions(id);
  const type = exType(e);
  const timedMode = type !== 'weight';
  // Only the sets that match how this exercise is recorded (in case its type was changed later).
  const sess = sessions.map((s) => ({ ...s, sets: s.sets.filter((x) => isTimed(x) === timedMode) })).filter((s) => s.sets.length);
  const allSets = sess.flatMap((s) => s.sets);
  const chrono = sess.slice().reverse();
  const round2 = (n) => Math.round(n * 100) / 100;
  let tiles, note = '', title, chart;

  if (!timedMode) {
    let best = null, bestE = null;
    allSets.forEach((s) => {
      const w = dispW(s), v = e1rm(w, s.reps);
      if (!best || w > dispW(best) || (w === dispW(best) && s.reps > best.reps)) best = s;
      if (!bestE || v > bestE.v) bestE = { v, s };
    });
    tiles = [
      ['Best set', best ? esc(fmtSet(best)) : '—'],
      ['Est. 1RM', bestE ? `${fmtNum(Math.round(bestE.v))} <small>${unit()}</small>` : '—'],
    ];
    if (bestE) note = `Est. 1RM uses Epley (weight × (1 + reps/30)), from ${esc(fmtSet(bestE.s))} on ${fmtDate(bestE.s.loggedAt)}.`;
    title = 'Weight over time';
    chart = {
      series: [{ k: 'v1', label: 'Top set' }, { k: 'v2', label: 'Est. 1RM' }],
      fmt: (v) => fmtNum(Math.round(v)),
      points: chrono.map((ses) => {
        const top = ses.sets.reduce((a, s) => (dispW(s) > dispW(a) || (dispW(s) === dispW(a) && s.reps > a.reps) ? s : a));
        const est = Math.max(...ses.sets.map((s) => e1rm(dispW(s), s.reps)));
        return { t: +new Date(ses.date), date: ses.date, v1: dispW(top), v2: est, tip: `Top set ${esc(fmtSet(top))}<br>Est. 1RM ${fmtNum(Math.round(est))} ${unit()}` };
      }),
    };
  } else {
    const hasDist = allSets.some((s) => s.distance);
    const totalSec = allSets.reduce((a, s) => a + s.duration, 0);
    if (hasDist) {
      const far = allSets.reduce((a, s) => (dispDist(s) > dispDist(a) ? s : a));
      const totalDist = allSets.reduce((a, s) => a + dispDist(s), 0);
      tiles = [
        ['Longest', `${fmtNum(dispDist(far))} <small>${distUnit()} · ${fmtDur(far.duration)}</small>`],
        ['Total', `${fmtNum(round2(totalDist))} <small>${distUnit()} · ${fmtDur(totalSec)}</small>`],
      ];
    } else {
      const longest = allSets.reduce((a, s) => (!a || s.duration > a.duration ? s : a), null);
      tiles = [['Longest', longest ? fmtDur(longest.duration) : '—'], ['Total time', allSets.length ? fmtDur(totalSec) : '—']];
    }
    title = hasDist ? `Distance per session (${distUnit()})` : 'Longest time per session';
    chart = {
      series: [{ k: 'v1', label: hasDist ? 'Distance' : 'Longest' }],
      fmt: hasDist ? (v) => fmtNum(Math.round(v * 10) / 10) : (v) => fmtDur(v * 60),
      points: chrono.map((ses) => ({
        t: +new Date(ses.date), date: ses.date,
        v1: hasDist ? Math.max(...ses.sets.map(dispDist)) : Math.max(...ses.sets.map((s) => s.duration)) / 60,
        tip: esc(fmtSetsCompact(ses.sets)),
      })),
    };
  }
  chartState = chart;
  const manual = (await db.byIndex('prs', 'exerciseId', id)).sort((a, b) => setScore(b) - setScore(a));
  const manualHtml = `<div class="row" style="margin-top:8px"><h3 class="grow" style="margin:8px 0">Entered PRs</h3>
      <button class="btn" data-action="add-pr" data-ex="${id}">＋ Add PR</button></div>
    ${manual.length ? `<div class="list">${manual.map((p) => `<div class="list-item"><span class="grow"><b>${esc(fmtSet(p))}</b>
        <div class="sub">${fmtDate(p.loggedAt)}${p.note ? ` · ${esc(p.note)}` : ''}</div></span>
        <button class="icon-btn" data-action="delete-pr" data-id="${p.id}" aria-label="Remove PR">×</button></div>`).join('')}</div>`
      : '<div class="muted small">Add records from before you used the app; they count toward your PRs.</div>'}`;

  const stat = ([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  return `<button class="btn ghost" data-action="back" data-fallback="#/exercises" style="margin-left:-12px">‹ Back</button>
    <div class="row"><h1 class="grow">${esc(e.name)}</h1><button class="btn ghost" data-action="edit-ex" data-id="${e.id}">Edit</button></div>
    <div class="muted">${esc(e.category || 'Other')} · ${TYPES[type]}</div>
    <div class="stats">
      ${tiles.map(stat).join('')}
      ${stat(['Sessions', sess.length])}
      <div class="stat"><div class="k">Last done</div><div class="v" style="font-size:20px">${sess[0] ? fmtDate(sess[0].date) : '—'}</div></div>
    </div>
    ${note ? `<div class="muted small" style="margin:-4px 0 8px">${note}</div>` : ''}
    ${manualHtml}
    <h3>${title}</h3>
    ${chart.points.length >= 2 ? chartHtml(chart) : `<div class="card muted small">Log this exercise in at least two workouts to see a chart.</div>`}
    <h3>Every session</h3>
    ${sessions.length ? `<div class="list">${sessions.map((ses) => `<a class="list-item" href="#/w/${ses.workoutId}">
        <span class="grow"><b>${fmtDay(ses.date)}</b> <span class="muted small">${fmtTime(ses.date)}</span>
        <div class="sub" style="color:var(--text-2)">${esc(fmtSetsCompact(ses.sets))}</div></span><span class="chev">›</span></a>`).join('')}</div>`
      : `<div class="empty">Not logged yet.</div>`}`;
}

// ---------- chart (inline SVG; one axis; one or two series) ----------
let chartState = null;
const CH = { w: 340, h: 190, l: 40, r: 46, t: 12, b: 24 };
function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}
function chartScales({ points, series }) {
  const ys = points.flatMap((p) => series.map((s) => p[s.k]));
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const x = (t) => CH.l + ((t - t0) / (t1 - t0 || 1)) * (CH.w - CH.l - CH.r);
  const y = (v) => CH.t + (1 - (v - y0) / (y1 - y0 || 1)) * (CH.h - CH.t - CH.b);
  return { x, y, ticks };
}
function chartHtml(ch) {
  const { points, series, fmt } = ch;
  const { x, y, ticks } = chartScales(ch);
  const path = (k) => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  const last = points[points.length - 1];
  const showDots = points.length <= 24;
  // End labels, nudged apart if two series finish close together.
  const ly = series.map((s) => y(last[s.k]));
  if (ly.length === 2 && Math.abs(ly[0] - ly[1]) < 14) { const mid = (ly[0] + ly[1]) / 2; const up = ly[1] < ly[0] ? 1 : 0; ly[up] = mid - 7; ly[1 - up] = mid + 7; }
  const drawOrder = series.map((s, i) => ({ ...s, n: i + 1 })).reverse(); // series 1 on top
  return `<div class="chart" id="chart">
    ${series.length > 1 ? `<div class="legend">${series.map((s, i) => `<span><i style="background:var(--series-${i + 1})"></i>${s.label}</span>`).join('')}</div>` : ''}
    <svg viewBox="0 0 ${CH.w} ${CH.h}" role="img" aria-label="${series.map((s) => s.label).join(' and ')} per session">
      <g class="grid">${ticks.map((v) => `<line x1="${CH.l}" x2="${CH.w - CH.r}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>
      <g class="axis">${ticks.map((v) => `<text x="${CH.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join('')}
        <text x="${CH.l}" y="${CH.h - 4}">${fmtDate(points[0].date)}</text>
        <text x="${CH.w - CH.r}" y="${CH.h - 4}" text-anchor="end">${fmtDate(last.date)}</text></g>
      <line id="ch-x" y1="${CH.t}" y2="${CH.h - CH.b}" stroke="var(--muted)" stroke-width="1" style="display:none"/>
      ${drawOrder.map((s) => `<path class="s${s.n}" d="${path(s.k)}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
      ${showDots ? points.map((p) => drawOrder.map((s) => `<circle class="dot${s.n}" cx="${x(p.t)}" cy="${y(p[s.k])}" r="4"/>`).join('')).join('') : ''}
      ${series.map((s, i) => `<text class="lbl" x="${CH.w - CH.r + 6}" y="${ly[i] + 4}">${fmt(last[s.k])}</text>`).join('')}
      <rect id="ch-hit" x="0" y="0" width="${CH.w}" height="${CH.h}" fill="transparent"/>
    </svg>
    <div class="tip" id="ch-tip"></div>
  </div>`;
}
afterRender.e = () => {
  const box = $('#chart');
  if (!box || !chartState) return;
  const svg = $('svg', box), tip = $('#ch-tip'), cross = $('#ch-x');
  const { points, series } = chartState;
  const { x, y } = chartScales(chartState);
  const show = (ev) => {
    const r = svg.getBoundingClientRect();
    const sx = ((ev.clientX - r.left) / r.width) * CH.w;
    const p = points.reduce((a, b) => (Math.abs(x(b.t) - sx) < Math.abs(x(a.t) - sx) ? b : a));
    cross.setAttribute('x1', x(p.t)); cross.setAttribute('x2', x(p.t)); cross.style.display = '';
    tip.innerHTML = `<b>${fmtDay(p.date)}</b>${p.tip}`;
    const scale = r.width / CH.w;
    tip.style.left = `${Math.min(Math.max(x(p.t) * scale + 8, 70), r.width - 62)}px`;
    tip.style.top = `${Math.min(...series.map((s) => y(p[s.k]))) * scale + 30}px`;
    tip.style.display = 'block';
  };
  const hide = () => { tip.style.display = 'none'; cross.style.display = 'none'; };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
};

// ======================================================================
// PROGRESS (body stats + personal records)
// ======================================================================
const todayKey = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
// Date input value → ISO. Today keeps the current time; other days get noon so time zones can't shift the date.
function dateInputToIso(v, keepIso) {
  if (!v) return nowIso();
  if (keepIso && new Date(keepIso).toLocaleDateString('en-CA') === v) return keepIso;
  if (v === todayKey()) return nowIso();
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

async function viewProgress() {
  const [entries, profile, recs, ex] = await Promise.all([bodyEntries(), loadProfile(), personalRecords(), exercisesMap()]);
  const withW = entries.filter((e) => e.weight);
  const cur = withW[0];
  const bf = entries.find((e) => e.bodyFat);
  const b = bmi(cur, profile);
  const change = withW.length > 1 ? Math.round((dispBodyW(withW[0]) - dispBodyW(withW[withW.length - 1])) * 10) / 10 : null;
  const pts = withW.slice().reverse().map((e) => ({
    t: +new Date(e.date), date: e.date, v1: dispBodyW(e),
    tip: `${fmtNum(dispBodyW(e))} ${unit()}${e.bodyFat ? ` · ${fmtNum(e.bodyFat)}% fat` : ''}`,
  }));
  chartState = { series: [{ k: 'v1', label: 'Weight' }], fmt: (v) => fmtNum(Math.round(v * 10) / 10), points: pts };

  const stat = (k, v, sub = '') => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
  const statsHtml = `<div class="stats">
      ${stat('Weight', cur ? `${fmtNum(dispBodyW(cur))} <small>${unit()}</small>` : '—',
        change != null ? `${change > 0 ? '+' : ''}${fmtNum(change)} ${unit()} since ${fmtDate(withW[withW.length - 1].date)}` : (cur ? fmtDate(cur.date) : ''))}
      ${stat('Height', fmtHeight(profile.heightCm))}
      ${stat('BMI', b ?? '—', bmiLabel(b))}
      ${stat('Body fat', bf ? `${fmtNum(bf.bodyFat)}<small>%</small>` : '—', bf ? fmtDate(bf.date) : '')}
    </div>`;

  const entryRows = entries.slice(0, 8).map((e) => {
    const bits = [];
    if (e.weight) bits.push(`${fmtNum(dispBodyW(e))} ${unit()}`);
    if (e.bodyFat) bits.push(`${fmtNum(e.bodyFat)}% fat`);
    MEASUREMENTS.forEach(([k, label]) => { if (e[k]) bits.push(`${label.toLowerCase()} ${fmtNum(dispLen(e[k], e.lenUnit))}`); });
    return `<button class="list-item" data-action="edit-body" data-id="${e.id}"><span class="grow"><b>${fmtDay(e.date)}</b>
      <div class="sub">${esc(bits.join(' · ') || '—')}</div></span><span class="chev">›</span></button>`;
  }).join('');

  const records = [...recs.entries()].map(([id, s]) => ({ e: ex.get(id), s })).filter((r) => r.e)
    .sort((a, b2) => b2.s.loggedAt.localeCompare(a.s.loggedAt));
  const recRows = records.map(({ e, s }) => {
    const extra = isTimed(s) ? '' : s.reps > 1 ? ` · est. 1RM ${fmtNum(Math.round(e1rm(dispW(s), s.reps)))}` : '';
    return `<a class="list-item" href="#/e/${e.id}"><span class="grow"><b>${esc(e.name)}</b>
      <div class="sub" style="color:var(--text-2)">${esc(fmtSet(s))}${extra}</div></span>
      <span class="muted small" style="text-align:right">${fmtDate(s.loggedAt)}${s.manual ? '<br><span class="tag">entered</span>' : ''}</span></a>`;
  }).join('');

  const exCount = ex.size;
  return `<h1>Progress</h1>
    <div class="row"><h3 class="grow" style="margin:8px 0">Body</h3><button class="btn" data-action="log-body">＋ Log stats</button></div>
    ${statsHtml}
    ${pts.length >= 2 ? `<h3>Weight over time</h3>${chartHtml(chartState)}` : ''}
    ${entryRows ? `<h3>Recent entries</h3><div class="list">${entryRows}</div>` : '<div class="card muted small">Log your weight, height and body fat to track them over time.</div>'}
    <div class="row" style="margin-top:20px"><h3 class="grow" style="margin:8px 0">Personal records</h3><button class="btn" data-action="add-pr">＋ Add PR</button></div>
    ${recRows ? `<div class="list">${recRows}</div>` : '<div class="card muted small">Your best set for each exercise shows up here automatically. Add PRs from before you used the app with “Add PR”.</div>'}
    <h3>Exercises</h3>
    <a class="list-item list" href="#/exercises"><span class="grow"><b>All exercises</b><div class="sub">${exCount} exercises · history, charts, edit</div></span><span class="chev">›</span></a>`;
}
afterRender.progress = () => afterRender.e();

// ---------- body stats sheet ----------
async function openBodySheet(id) {
  const [e, profile, entries] = await Promise.all([id ? db.get('body', id) : null, loadProfile(), bodyEntries()]);
  const last = entries.find((x) => x.weight);
  const w = e ? dispBodyW(e) : last ? dispBodyW(last) : '';
  const lu = lenUnit();
  const inches = profile.heightCm ? Math.round(profile.heightCm / 2.54) : null;
  const heightFields = unit() === 'kg'
    ? `<input class="text" id="bf-hcm" inputmode="decimal" placeholder="cm" value="${profile.heightCm ? Math.round(profile.heightCm) : ''}">`
    : `<div class="row"><input class="text grow" id="bf-hft" inputmode="numeric" placeholder="ft" value="${inches ? Math.floor(inches / 12) : ''}">
       <input class="text grow" id="bf-hin" inputmode="numeric" placeholder="in" value="${inches ? inches % 12 : ''}"></div>`;
  const hasMeas = e && MEASUREMENTS.some(([k]) => e[k]);
  openSheet(`
    <h2>${e ? 'Edit' : 'Log'} body stats</h2>
    <div class="stack">
      <input class="text" type="date" id="bf-date" value="${e ? new Date(e.date).toLocaleDateString('en-CA') : todayKey()}" max="${todayKey()}">
      <div class="logger" data-scope="form" style="border-radius:14px">
        ${stepperHtml('bw', w === '' ? '' : fmtNum(w), `Weight · ${unit()}`, 'decimal', 'optional', unit() === 'kg' ? 0.1 : 0.2)}
        ${stepperHtml('bfp', e?.bodyFat ? fmtNum(e.bodyFat) : '', 'Body fat · %', 'decimal', 'optional', 0.5)}
      </div>
      <div class="small muted">Height</div>
      ${heightFields}
      <details class="meas" ${hasMeas ? 'open' : ''}><summary>Measurements (${lu}, optional)</summary>
        <div class="meas-grid">${MEASUREMENTS.map(([k, label]) => `<label><span>${label}</span>
          <input class="text" inputmode="decimal" data-meas="${k}" value="${e?.[k] ? fmtNum(dispLen(e[k], e.lenUnit)) : ''}"></label>`).join('')}</div>
      </details>
      <button class="btn primary block" data-action="save-body" data-id="${e?.id || ''}">Save</button>
      ${e ? `<button class="btn danger block" data-action="delete-body" data-id="${e.id}">Delete entry</button>` : ''}
      <button class="btn ghost block" data-action="close-sheet">Cancel</button>
    </div>`);
}

async function saveBody(id) {
  const scope = $('[data-scope="form"]');
  const num = (v) => { const n = parseNum(v); return n > 0 ? Math.round(n * 10) / 10 : null; };
  const weight = num($('input[data-field="bw"]', scope).value);
  const bodyFat = num($('input[data-field="bfp"]', scope).value);
  const meas = Object.fromEntries(MEASUREMENTS.map(([k]) => [k, num($(`[data-meas="${k}"]`).value)]));
  // height → profile
  let heightCm = null;
  if (unit() === 'kg') heightCm = num($('#bf-hcm').value);
  else {
    const ft = parseNum($('#bf-hft').value), inch = parseNum($('#bf-hin').value);
    if (ft || inch) heightCm = Math.round((ft * 12 + inch) * 2.54 * 10) / 10;
  }
  const profile = await loadProfile();
  if (heightCm && heightCm !== profile.heightCm) await saveProfile({ ...profile, heightCm });

  const hasEntry = weight || bodyFat || Object.values(meas).some(Boolean);
  if (!hasEntry && !heightCm) return toast('Enter at least one value');
  const old = id ? await db.get('body', id) : null;
  if (hasEntry) {
    await db.put('body', {
      id: id || uid(), date: dateInputToIso($('#bf-date').value, old?.date),
      weight, unit: unit(), bodyFat, lenUnit: lenUnit(), ...meas, note: old?.note || '',
    });
  } else if (id) await db.del('body', id);
  closeSheet(); buzz(15); toast('Saved'); render();
}

// ---------- manual PR sheet ----------
async function openPrSheet(presetExId = '') {
  const ex = [...(await exercisesMap()).values()].sort((a, b) => a.name.localeCompare(b.name));
  const groups = CATEGORIES.map((c) => [c, ex.filter((e) => (e.category || 'Other') === c)]).filter(([, l]) => l.length);
  openSheet(`
    <h2>Add a personal record</h2>
    <div class="stack">
      <select class="text" id="pr-ex">
        <option value="">Choose exercise…</option>
        ${groups.map(([c, l]) => `<optgroup label="${esc(c)}">${l.map((e) =>
          `<option value="${e.id}" data-type="${exType(e)}" ${e.id === presetExId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup>`).join('')}
      </select>
      <div id="pr-fields"></div>
      <input class="text" type="date" id="pr-date" value="${todayKey()}" max="${todayKey()}">
      <input class="text" id="pr-note" placeholder="Note (optional)" autocomplete="off">
      <button class="btn primary block" data-action="save-pr">Save PR</button>
      <button class="btn ghost block" data-action="close-sheet">Cancel</button>
    </div>`);
  drawPrFields();
}
function drawPrFields() {
  const sel = $('#pr-ex'), box = $('#pr-fields');
  if (!sel || !box) return;
  const type = sel.selectedOptions[0]?.dataset.type;
  if (!type) { box.innerHTML = ''; return; }
  const d = type === 'weight' ? { w: 0, r: 1 } : { d: type === 'time' ? 60 : 20 * 60, dist: 0 };
  box.innerHTML = `<div class="logger" data-scope="form" data-kind="${type}" style="border-radius:14px">${fieldsHtml(type, d)}</div>`;
}
async function savePr() {
  const exId = $('#pr-ex').value;
  if (!exId) return toast('Choose an exercise');
  const vals = readScope($('#pr-fields [data-scope="form"]'));
  const timed = 'd' in vals;
  if (timed ? !vals.d : !vals.r) return toast(timed ? 'Enter a time' : 'Enter reps'); // weight 0 = bodyweight
  const base = { id: uid(), exerciseId: exId, manual: true, loggedAt: dateInputToIso($('#pr-date').value), note: $('#pr-note').value.trim(), unit: unit(), order: 0 };
  await db.put('prs', timed
    ? { ...base, weight: 0, reps: 0, duration: vals.d, distance: vals.dist || null, distUnit: distUnit() }
    : { ...base, weight: vals.w, reps: vals.r });
  closeSheet(); buzz(15); toast('PR saved'); render();
}

// ======================================================================
// BODY (3D muscle map)
// ======================================================================
async function viewBody() {
  return `<div class="body3d">
      <div class="body-canvas" id="body-canvas"></div>
      <div class="body-top">
        <h1>Muscles</h1>
        <div class="muted small">Drag to spin · pinch or scroll to zoom · two fingers to move · tap a muscle</div>
      </div>
      <div class="body-ctrls">
        <button class="btn" data-action="body-view" data-v="front">Front</button>
        <button class="btn" data-action="body-view" data-v="back">Back</button>
        <button class="btn" data-action="body-view" data-v="reset">Reset</button>
      </div>
      <div class="body-loading" id="body-loading">Loading 3D model…</div>
      <div class="body-chips">${MUSCLES.map((m) => `<button class="chip" data-action="muscle" data-m="${m.id}">${esc(m.name)}</button>`).join('')}</div>
    </div>`;
}
afterRender.body = async () => {
  const el = $('#body-canvas');
  try {
    const mod = await import('./body3d.js');
    if (route().name !== 'body' || !el.isConnected) return;
    const loading = $('#body-loading');
    body3d = mod.mount(el, {
      onSelect: (id) => openMuscle(id),
      onProgress: (f) => { if (loading) loading.textContent = `Loading 3D model… ${Math.round(f * 100)}%`; },
      onReady: () => loading?.remove(),
      onError: () => { if (loading) loading.innerHTML = 'Couldn’t load the 3D model. It needs an internet connection the first time.<br>You can still pick a muscle below.'; },
    });
  } catch (err) {
    const l = $('#body-loading');
    if (l) l.innerHTML = 'The 3D model needs an internet connection the first time it loads.<br>You can still pick a muscle below.';
  }
};

async function openMuscle(id) {
  const m = musclesById[id];
  if (!m) return;
  body3d?.select(id);
  document.querySelectorAll('.body-chips .chip').forEach((c) => c.classList.toggle('on', c.dataset.m === id));
  const [ex, sets] = await Promise.all([exercisesMap(), db.all('sets')]);
  const lastDone = new Map();
  sets.forEach((s) => { if ((lastDone.get(s.exerciseId) || '') < s.loggedAt) lastDone.set(s.exerciseId, s.loggedAt); });
  // Built-in matches first, then your own exercises whose names match this muscle.
  const ids = new Set(m.exercises.filter((x) => ex.has(x)));
  for (const e of ex.values()) if (!e.builtin && m.match?.test(e.name) && !m.exclude?.test(e.name)) ids.add(e.id);
  const list = [...ids].map((x) => ex.get(x)).sort((a, b) => (lastDone.get(b.id) || '').localeCompare(lastDone.get(a.id) || ''));
  const canAdd = !!state.activeId;
  openSheet(`
    <div class="row"><h2 class="grow" style="margin:0">${esc(m.name)}</h2><button class="btn ghost" data-action="close-sheet">Close</button></div>
    <div class="muted small">${esc(m.about)}</div>
    <h3>Exercises</h3>
    <div class="list">${list.map((e) => `<div class="list-item">
        <a class="grow linkish" href="#/e/${e.id}" data-action="close-sheet" style="text-decoration:none"><b>${esc(e.name)}</b>
          <div class="sub">${lastDone.get(e.id) ? `Last done ${fmtDate(lastDone.get(e.id))}` : 'Not logged yet'}${e.builtin ? '' : ' · yours'}</div></a>
        ${canAdd ? `<button class="btn" data-action="muscle-add" data-ex="${e.id}" aria-label="Add ${esc(e.name)} to workout">＋</button>` : ''}
      </div>`).join('')}</div>
    ${canAdd ? '' : '<div class="muted small" style="margin-top:6px">Start a workout to add these with one tap.</div>'}
    <h3>Stretches</h3>
    ${m.stretches.map((s) => `<div class="card stretch"><div class="row"><b class="grow">${esc(s.name)}</b><span class="tag">${esc(s.hold)}</span></div>
      <div class="small" style="color:var(--text-2);margin-top:4px">${esc(s.how)}</div></div>`).join('')}
  `, { tall: true });
  $('#sheet-root .sheet').classList.add('muscle-sheet');
}

// ======================================================================
// SETTINGS
// ======================================================================
async function viewSettings() {
  const [workouts, sets] = await Promise.all([db.all('workouts'), db.all('sets')]);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const stepOpts = unit() === 'kg' ? [1, 1.25, 2.5, 5] : [2.5, 5, 10];
  const step = weightStep();
  return `<h1>Settings</h1>
    <h3>Units</h3>
    <div class="seg">${['lb', 'kg'].map((u) => `<button class="${unit() === u ? 'on' : ''}" data-action="unit" data-u="${u}">${u === 'lb' ? 'Pounds (lb)' : 'Kilograms (kg)'}</button>`).join('')}</div>
    <p class="muted small">Past sets keep the unit they were logged in and are converted for display.</p>
    <h3>Weight +/− step</h3>
    <div class="seg">${stepOpts.map((v) => `<button class="${v === step ? 'on' : ''}" data-action="step-size" data-v="${v}">${v} ${unit()}</button>`).join('')}</div>
    <h3>Backup</h3>
    <div class="stack">
      <button class="btn block primary" data-action="export-json">Export backup (JSON)</button>
      <button class="btn block" data-action="import-json">Import backup…</button>
      <button class="btn block" data-action="export-csv">Export CSV (spreadsheet)</button>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </div>
    <p class="muted small">Your data lives only on this device. Export a backup regularly and keep it somewhere safe (Files, iCloud Drive, Google Drive, email to yourself). Importing merges with what's here; nothing is overwritten except entries with the same id.</p>
    <h3>Storage</h3>
    <div class="card small">
      <div>${workouts.length} workouts · ${sets.length} sets</div>
      <div class="muted">${persisted ? 'Persistent storage granted — the browser won’t clear it to save space.' : 'Storage may be cleared by the browser under pressure.'}</div>
      ${persisted ? '' : '<button class="btn block" data-action="persist" style="margin-top:10px">Ask to keep data permanently</button>'}
    </div>
    <h3>Display</h3>
    <div class="card small stack">
      <div>Leave this on Auto. The other options are workarounds kept for troubleshooting; they change right away.</div>
      <div class="seg fit-seg">${Object.entries(FIT_MODES).map(([m, label]) =>
        `<button class="${(ls.get('fitMode') || 'auto') === m ? 'on' : ''}" data-action="fit-mode" data-m="${m}">${label}</button>`).join('')}</div>
      <div class="muted" id="display-info">${displayInfoText()}</div>
    </div>
    <h3>Danger zone</h3>
    <button class="btn danger block" data-action="erase">Erase all data</button>
    <p class="muted small" style="text-align:center;margin-top:24px">LiftLog ${APP_VERSION} · works offline · no account, no tracking</p>
    <p class="muted small" style="text-align:center">3D muscle model adapted from <a href="https://github.com/Z-Anatomy/Models-of-human-anatomy" target="_blank" rel="noopener">Z-Anatomy</a>
      (Gauthier Kervyn) and <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html" target="_blank" rel="noopener">BodyParts3D</a>
      (© DBCLS), via <a href="https://github.com/kalibismail/gymmetry-muscle-model" target="_blank" rel="noopener">gymmetry-muscle-model</a>.
      Licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.</p>`;
}
function displayInfoText() {
  const i = displayInfo();
  return `App ${i.version} · ${i.mode}<br>Screen ${i.screen} · viewport ${i.viewport} · visual ${i.visual}<br>Safe area ${i.safe} · bar ends at ${i.navBottom}`;
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], filename, { type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    return navigator.share({ files: [file], title: filename }).catch(() => {});
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const stamp = () => new Date().toLocaleDateString('en-CA');

// ======================================================================
// ACTIONS (one delegated click handler)
// ======================================================================
const actions = {
  // history
  'hist-mode': (el) => { ls.set('historyMode', el.dataset.m); render(); },
  'cal-move': (el) => {
    const step = Number(el.dataset.step);
    if (!step) state.calMonth = null;
    else {
      const [y, m] = (state.calMonth || new Date().toLocaleDateString('en-CA').slice(0, 7)).split('-').map(Number);
      state.calMonth = new Date(y, m - 1 + step, 1).toLocaleDateString('en-CA').slice(0, 7);
    }
    drawCalendar();
  },
  'cal-day': (el) => openCalendarDay(el.dataset.d),
  // progress
  'log-body': () => openBodySheet(),
  'edit-body': (el) => openBodySheet(el.dataset.id),
  'save-body': (el) => saveBody(el.dataset.id),
  'delete-body': async (el) => {
    const e = await db.get('body', el.dataset.id);
    await db.del('body', el.dataset.id);
    closeSheet(); render();
    toast('Entry deleted', { label: 'Undo', fn: async () => { await db.put('body', e); render(); } });
  },
  'add-pr': (el) => openPrSheet(el.dataset.ex || ''),
  'save-pr': () => savePr(),
  'delete-pr': async (el) => {
    const p = await db.get('prs', el.dataset.id);
    await db.del('prs', el.dataset.id);
    render();
    toast('PR removed', { label: 'Undo', fn: async () => { await db.put('prs', p); render(); } });
  },
  // body map
  muscle: (el) => openMuscle(el.dataset.m),
  'body-view': (el) => body3d?.view(el.dataset.v),
  'muscle-add': async (el) => {
    const wo = await db.get('workouts', state.activeId);
    if (!wo) return toast('Start a workout first');
    wo.exerciseOrder = wo.exerciseOrder || [];
    if (!wo.exerciseOrder.includes(el.dataset.ex)) wo.exerciseOrder.push(el.dataset.ex);
    await db.put('workouts', wo);
    state.focusEx = el.dataset.ex;
    el.textContent = '✓'; el.disabled = true; buzz(12);
    toast('Added to your workout');
  },
  'fit-mode': (el) => {
    ls.set('fitMode', el.dataset.m);
    fitScreen();
    el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
    requestAnimationFrame(() => { const d = $('#display-info'); if (d) d.innerHTML = displayInfoText(); });
  },
  'close-sheet': () => { closeSheet(); confirmSheet.resolve?.(false); confirmSheet.resolve = null; },
  'confirm-yes': () => { const r = confirmSheet.resolve; confirmSheet.resolve = null; closeSheet(); r?.(true); },
  'toast-act': () => { $('#toast').classList.remove('show'); toast.action?.(); },
  back: (el) => { if (history.length > 1) history.back(); else location.hash = el.dataset.fallback; },

  start: async () => {
    const w = { id: uid(), startedAt: nowIso(), endedAt: null, notes: '', exerciseOrder: [] };
    await db.put('workouts', w);
    setActive(w.id);
    state.focusEx = null; state.drafts = {};
    buzz(15);
    await render();
    // After an await the keyboard can't be summoned on iOS anyway; Recent is right there to tap.
    openPicker({ focus: !matchMedia('(pointer: coarse)').matches });
  },
  continue: async (el) => { setActive(el.dataset.id); if (route().name !== 'workout') location.hash = '#/workout'; else render(); },
  finish: () => finishWorkout(state.activeId),
  'finish-other': (el) => finishWorkout(el.dataset.id),
  'add-ex': () => openPicker(),
  pick: (el) => addToWorkout(el.dataset.ex),
  'create-ex': async (el) => {
    const name = $('#pick-q').value, type = el.dataset.type || 'weight';
    const e = await createExercise(name, guessType(name) === 'cardio' ? 'Cardio' : 'Other', type);
    if (e) { toast(`Added “${e.name}”`); addToWorkout(e.id); }
  },
  focus: (el) => { state.focusEx = el.dataset.ex; render(); },
  'remove-ex': async (el, ev) => {
    ev.stopPropagation();
    const wo = await db.get('workouts', state.activeId);
    wo.exerciseOrder = (wo.exerciseOrder || []).filter((x) => x !== el.dataset.ex);
    await db.put('workouts', wo);
    render();
  },
  step: (el) => {
    const scope = el.closest('[data-scope]');
    const f = el.dataset.field, dir = Number(el.dataset.dir);
    const input = $(`input[data-field="${f}"]`, scope);
    if (f === 'd') {
      const stepS = scope.dataset.kind === 'cardio' ? 60 : 15;
      const cur = parseDur(input.value, scope.dataset.kind === 'cardio');
      input.value = fmtDur(Math.max(0, roundTo(cur, stepS) + dir * stepS));
    } else {
      const stepV = el.dataset.step ? Number(el.dataset.step) : f === 'w' ? weightStep() : f === 'dist' ? 0.1 : 1;
      const next = Math.max(0, parseNum(input.value) + dir * stepV);
      input.value = fmtNum(Math.round(next * 100) / 100);
    }
    if (isDraftScope(scope.dataset.scope)) state.drafts[scope.dataset.scope] = readScope(scope);
    buzz(5);
  },
  log: (el) => logSet(el.dataset.ex, readScope(el.closest('[data-scope]'))),
  repeat: async (el) => {
    const exId = el.dataset.ex;
    const mine = (await workoutSets(state.activeId)).filter((s) => s.exerciseId === exId);
    const src = mine[mine.length - 1] || (await exerciseSessions(exId)).find((h) => h.workoutId !== state.activeId)?.sets[0];
    if (src) logSet(exId, setFromSource(src));
  },
  timer: async (el) => {
    const exId = el.dataset.ex;
    if (state.timer?.exId === exId) {
      const secs = Math.round((Date.now() - state.timer.start) / 1000);
      state.timer = null;
      const scope = el.closest('[data-scope]');
      if (scope.dataset.kind === 'time' && secs >= 1) { await logSet(exId, { d: secs, dist: 0 }); return; }
      state.drafts[exId] = { ...readScope(scope), d: secs }; // cardio: fill time, then add distance and log
      buzz(15);
      return render();
    }
    state.timer = { exId, start: Date.now() };
    buzz(15);
    render();
  },
  rate: async (el) => {
    const box = el.closest('.rating');
    const w = await db.get('workouts', box.dataset.wid);
    if (!w) return;
    const k = el.dataset.k, v = Number(el.dataset.v);
    w[k] = w[k] === v ? null : v; // tap again to clear
    await db.put('workouts', w);
    box.querySelectorAll(`[data-k="${k}"]`).forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === w[k]));
    if (k === 'effort') $('[data-cap="effort"]', box).textContent = effortCaption(w.effort);
    buzz(8);
    if (box.closest('.sheet')) render(); // refresh cards behind the summary sheet
  },
  'pick-type': (el) => el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)),
  'edit-set': (el) => { if (!swipe.suppressClick) openEditSet(el.dataset.set); },
  'save-set': async (el) => {
    const s = await db.get('sets', el.dataset.set);
    const d = readScope($('[data-scope="edit"]'));
    if (isTimed(s)) {
      if (!d.d) return toast('Time must be more than 0');
      s.duration = d.d;
      // Store distance in the current unit only if it changed (avoid rounding drift).
      if (Math.abs(d.dist - dispDist(s)) > 0.001) { s.distance = d.dist || null; s.distUnit = distUnit(); }
    } else {
      if (!d.r) return toast('Reps must be at least 1');
      if (Math.abs(d.w - dispW(s)) > 0.001) { s.weight = d.w; s.unit = unit(); }
      s.reps = d.r;
    }
    await db.put('sets', s);
    if (s.workoutId === state.activeId) state.drafts[s.exerciseId] = setFromSource(s);
    closeSheet(); buzz(10); render();
  },
  'delete-set': (el) => removeSet(el.dataset.set),
  'delete-workout': async (el) => {
    const ok = await confirmSheet({ title: 'Delete this workout?', body: 'All its sets will be removed. This can’t be undone (unless you have a backup).', ok: 'Delete workout', danger: true });
    if (!ok) return;
    await deleteWorkout(el.dataset.id);
    if (state.activeId === el.dataset.id) setActive(null);
    location.hash = '#/history';
    toast('Workout deleted');
  },

  'new-ex': () => openExerciseForm(null, state.exFilter.trim()),
  'edit-ex': async (el) => openExerciseForm(await db.get('exercises', el.dataset.id)),
  'save-ex': async (el) => {
    const name = $('#exf-name').value.trim(), category = $('#exf-cat').value;
    const type = $('#exf-type .on')?.dataset.type || 'weight';
    if (!name) return toast('Give it a name');
    if (el.dataset.id) {
      const e = await db.get('exercises', el.dataset.id);
      await db.put('exercises', { ...e, name, category, type });
      delete state.drafts[e.id];
    } else {
      await createExercise(name, category, type);
      state.exFilter = '';
    }
    closeSheet(); toast('Saved'); render();
  },
  'delete-ex': async (el) => {
    const n = (await db.byIndex('sets', 'exerciseId', el.dataset.id)).length;
    const ok = await confirmSheet({ title: 'Delete exercise?', body: n ? `This also deletes the ${n} set${n === 1 ? '' : 's'} logged for it.` : '', ok: 'Delete', danger: true });
    if (!ok) return;
    await deleteExercise(el.dataset.id);
    location.hash = '#/exercises';
  },

  unit: async (el) => { await saveSettings({ unit: el.dataset.u }); state.drafts = {}; render(); },
  'step-size': async (el) => { await saveSettings(unit() === 'kg' ? { stepKg: +el.dataset.v } : { stepLb: +el.dataset.v }); render(); },
  'export-json': async () => download(`liftlog-backup-${stamp()}.json`, JSON.stringify(await exportJson(), null, 1), 'application/json'),
  'export-csv': async () => download(`liftlog-sets-${stamp()}.csv`, await exportCsv(), 'text/csv'),
  'import-json': () => $('#import-file').click(),
  persist: async () => {
    const ok = await navigator.storage?.persist?.();
    toast(ok ? 'Storage will be kept' : 'Browser declined — install the app to the home screen and try again');
    render();
  },
  erase: async () => {
    const ok = await confirmSheet({ title: 'Erase everything?', body: 'Deletes every workout, set and custom exercise on this device. Export a backup first if you might want it.', ok: 'Erase all data', danger: true });
    if (!ok) return;
    await eraseAll();
    await ensureSeed(); await loadSettings();
    setActive(null); state.drafts = {};
    toast('All data erased'); render();
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  const link = ev.target.closest('a[href]');
  if (link && link !== el && el.contains(link)) return; // a link inside an actionable card wins
  if (el.tagName === 'A' && el.dataset.action === 'close-sheet') { closeSheet(); return; } // let the link navigate
  ev.preventDefault();
  fn(el, ev);
});

// Keep the logger draft in sync with typed values; select-all on focus for fast overwrite.
document.addEventListener('input', (ev) => {
  const scope = ev.target.closest?.('.logger[data-scope]');
  if (scope && isDraftScope(scope.dataset.scope)) state.drafts[scope.dataset.scope] = readScope(scope);
});
document.addEventListener('focusin', (ev) => { if (ev.target.matches?.('.field input')) setTimeout(() => ev.target.select(), 0); });
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.matches?.('.logger input')) {
    ev.target.blur();
    $('[data-action="log"], [data-action="save-set"]', ev.target.closest('.logger').parentElement)?.click();
  }
  if (ev.key === 'Escape') actions['close-sheet']();
});
document.addEventListener('change', async (ev) => {
  if (ev.target.id === 'pr-ex') return drawPrFields();
  if (ev.target.id !== 'import-file') return;
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const res = await importJson(JSON.parse(await file.text()));
    toast(`Imported ${res.workouts} workouts, ${res.sets} sets`);
    render();
  } catch (err) {
    toast(err.message || 'Import failed');
  }
});

// ---------- swipe left on a set row to delete ----------
const swipe = { row: null, x: 0, y: 0, dx: 0, active: false, suppressClick: false };
document.addEventListener('pointerdown', (ev) => {
  const row = ev.target.closest('.set-row');
  if (!row || ev.button > 0) return;
  Object.assign(swipe, { row, x: ev.clientX, y: ev.clientY, dx: 0, active: false, suppressClick: false });
});
document.addEventListener('pointermove', (ev) => {
  if (!swipe.row) return;
  const dx = ev.clientX - swipe.x, dy = ev.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dy) > 10) { swipe.row = null; return; }
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { swipe.active = true; swipe.row.classList.add('dragging'); }
  }
  if (swipe.active) { swipe.dx = Math.min(0, dx); swipe.row.style.transform = `translateX(${swipe.dx}px)`; }
});
const endSwipe = () => {
  const { row, active, dx } = swipe;
  swipe.row = null;
  if (!row || !active) return;
  swipe.suppressClick = true;
  setTimeout(() => { swipe.suppressClick = false; }, 50);
  row.classList.remove('dragging');
  if (dx < -Math.min(110, row.offsetWidth * 0.3)) {
    row.style.transform = 'translateX(-100%)';
    setTimeout(() => removeSet(row.dataset.set), 150);
  } else row.style.transform = '';
};
document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', endSwipe);

// ---------- live timers ----------
function tick() {
  const t = $('#timer');
  if (t) t.textContent = fmtClock(Date.now() - new Date(t.dataset.start));
  const s = $('#since');
  if (s?.dataset.last) s.textContent = `last set ${fmtClock(Date.now() - new Date(s.dataset.last))} ago`;
  const sw = $('#sw');
  if (sw && state.timer) sw.textContent = fmtDur((Date.now() - state.timer.start) / 1000);
}
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

// ---------- boot ----------
window.addEventListener('hashchange', () => { closeSheet(); render(); view().scrollTop = 0; });

// ---------- bottom-bar fit (see Settings → Display) ----------
// iOS home-screen apps can under-report the viewport height by the status bar,
// leaving a gap under the nav. The user can pick which workaround looks right.
export const APP_VERSION = 'v7';
const FIT_MODES = { auto: 'Auto', standard: 'Off', screen: 'Stretch A', inset: 'Stretch B', fill: 'Fill' };
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function fitScreen() {
  const root = document.documentElement;
  root.style.setProperty('--screen-h', `${screen.height}px`);
  let mode = ls.get('fitMode') || 'auto';
  // Auto = no workaround: with the solid status bar the app's window already reaches the bottom edge.
  if (mode === 'auto') mode = 'standard';
  Object.keys(FIT_MODES).forEach((m) => root.classList.toggle(`fit-${m}`, m === mode));
}
function displayInfo() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);visibility:hidden';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const info = {
    version: APP_VERSION,
    mode: isStandalone() ? 'home screen' : 'browser',
    screen: `${screen.width}×${screen.height}`,
    viewport: `${innerWidth}×${innerHeight}`,
    visual: window.visualViewport ? `${Math.round(visualViewport.height)}` : '—',
    safe: `top ${parseFloat(cs.paddingTop)} · bottom ${parseFloat(cs.paddingBottom)}`,
    navBottom: Math.round($('.tabbar').getBoundingClientRect().bottom),
  };
  probe.remove();
  return info;
}
fitScreen();
window.addEventListener('resize', fitScreen);

async function boot() {
  await ensureSeed();
  await loadSettings();
  // First launch from the home screen: ask the browser to keep our data.
  if (matchMedia('(display-mode: standalone)').matches) navigator.storage?.persist?.().catch(() => {});
  await render();
}
boot().catch((err) => {
  view().innerHTML = `<div class="empty">Couldn't open the database.<br><small>${esc(err?.message || err)}</small></div>`;
});

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller; // false on the very first install
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'activated' && hadController)
            toast('App updated', { label: 'Reload', fn: () => location.reload() });
        });
      });
    }).catch(() => {});
  });
}

// expose for debugging in the console
window.liftlog = { db, render, state, convert, get body3d() { return body3d; } };
