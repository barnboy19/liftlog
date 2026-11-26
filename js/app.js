import { db } from './db.js';
import {
  CATEGORIES, settings, ensureSeed, loadSettings, saveSettings, weightStep, uid, nowIso,
  convert, dispW, fmtNum, fmtW, fmtSet, fmtSetsCompact, fmtDate, fmtDay, fmtTime, fmtDuration, fmtClock,
  isToday, dayKey, e1rm, exercisesMap, workoutSets, allWorkouts, exerciseSessions, recentExerciseIds,
  deleteWorkout, deleteExercise, exportJson, importJson, exportCsv, eraseAll,
  TYPES, exType, guessType, isTimed, distUnit, dispDist, fmtDur, parseDur, setScore, EFFORT_LABELS, FEELINGS,
} from './data.js';

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
const TAB_FOR = { workout: 'workout', history: 'history', w: 'history', exercises: 'exercises', e: 'exercises', settings: 'settings' };

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const r = route();
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === TAB_FOR[r.name]));
  const views = { workout: viewWorkout, history: viewHistory, w: viewWorkoutDetail, exercises: viewExercises, e: viewExercise, settings: viewSettings };
  const html = await (views[r.name] || viewWorkout)(r.id);
  if (seq !== renderSeq) return; // a newer render started
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
  const lastSetAt = sets.length ? sets.reduce((a, s) => (s.loggedAt > a ? s.loggedAt : a), '') : null;

  const cards = order.map((exId) => {
    const e = ex.get(exId) || { name: 'Unknown exercise' };
    const mine = sets.filter((s) => s.exerciseId === exId);
    const prior = histories[exId].filter((h) => h.workoutId !== w.id);
    const prev = prior[0];
    const priorBest = Math.max(0, ...prior.flatMap((h) => h.sets.map(setScore)));
    // Flag the best set today if it beats everything before today.
    let prId = null;
    if (prior.length) {
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

function stepperHtml(field, text, label, mode, placeholder = '') {
  return `<div class="stepper">
      <button data-action="step" data-field="${field}" data-dir="-1" aria-label="Decrease ${label}">−</button>
      <div class="field"><label>${label}</label>
        <input data-field="${field}" inputmode="${mode}" enterkeyhint="done" autocomplete="off" value="${esc(text)}" placeholder="${placeholder}" aria-label="${label}"></div>
      <button data-action="step" data-field="${field}" data-dir="1" aria-label="Increase ${label}">+</button>
    </div>`;
}

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
  return `<h1>History</h1>
    <input class="search" id="hist-q" type="search" placeholder="Filter by exercise" value="${esc(state.historyFilter)}" autocomplete="off">
    <div id="hist-list"></div>`;
}
afterRender.history = () => {
  const q = $('#hist-q');
  q.addEventListener('input', () => { state.historyFilter = q.value; drawHistory(); });
  drawHistory();
};
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
  return `<div class="row"><h1 class="grow">Exercises</h1><button class="btn" data-action="new-ex">＋ New</button></div>
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
    <h3>Danger zone</h3>
    <button class="btn danger block" data-action="erase">Erase all data</button>
    <p class="muted small" style="text-align:center;margin-top:24px">LiftLog · works offline · no account, no tracking</p>`;
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
      const stepV = f === 'w' ? weightStep() : f === 'dist' ? 0.1 : 1;
      const next = Math.max(0, parseNum(input.value) + dir * stepV);
      input.value = fmtNum(Math.round(next * 100) / 100);
    }
    if (scope.dataset.scope !== 'edit') state.drafts[scope.dataset.scope] = readScope(scope);
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
  if (scope && scope.dataset.scope !== 'edit') state.drafts[scope.dataset.scope] = readScope(scope);
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

// iOS home-screen apps under-report the viewport height by the status bar;
// give CSS the true screen height (portrait-only app, so screen.height is right).
function fitScreen() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone && screen.height > innerHeight) document.documentElement.style.setProperty('--screen-h', `${screen.height}px`);
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
window.liftlog = { db, render, state, convert };
