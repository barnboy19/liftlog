# LiftLog

Offline workout tracker (PWA). Plain HTML/CSS/JS, no build step, no package manager, no test suite. All user data lives on the device in IndexedDB. See README.md for features and the data model.

## Code navigation

This repo is indexed in Graphify as `barnboy19/liftlog`. Pass that as `repository_id`. Follow the global rule: Graphify first, then read only the lines you need, and grep only for literal strings.

- Graphify answers describe the commit in their `commitSha`. Compare it with `git rev-parse HEAD`; for files changed since then, read the current file instead.
- Known Graphify mis-resolutions in this repo. Trust the function body over the edge:
  - `db.get(...)` is often shown as `ls.get` (js/app.js:1346).
  - `unit()` (js/app.js:17) is shown as `actions.unit`.
  - `navigator.storage.persist()` is shown as `actions.persist`.
  - `cache.put` in sw.js is shown as `db.put`.
- Graphify's import list for js/app.js is incomplete. Use call edges to see what is really used from data.js.

## Architecture

Dependencies: `app.js → data.js → db.js`, `app.js → db.js`, `app.js → muscles.js`, and `app.js ⇢ body3d.js` (dynamic import in `afterRender.body`). Nothing imports app.js.

- **js/app.js**: all screens and interactions.
  - `boot()` (end of file) calls `ensureSeed`, then `loadSettings`, then `render()`.
  - `render()` calls `route()`, which parses `#/name/id` from `location.hash`. It then picks a view function from its `views` table, writes `#view`, runs `afterRender[name]` and calls `tick()`.
  - Views return HTML strings: `viewWorkout`/`viewActive`, `viewHistory`, `viewWorkoutDetail` (`#/w/:id`), `viewExercises`, `viewExercise` (`#/e/:id`), `viewProgress`, `viewBody`, `viewSettings`.
  - Clicks go through the `actions` table, keyed by `data-action`. Handlers save and then call `render()` again.
- **js/data.js**: seed exercises, settings, queries (`allWorkouts`, `workoutSets`, `exerciseSessions`, `personalRecords`, …), formatting, unit conversion, backup (`exportJson`, `importJson`, `exportCsv`, `eraseAll`).
- **js/db.js**: tiny IndexedDB wrapper. `open()` holds the schema and its versioned upgrades. `db.get/all/byIndex/iterateDesc/put/putMany/del/txn` all go through `run()`.
- **js/muscles.js**: `MUSCLES` and `musclesById`.
- **js/body3d.js**: `mount()` for the Three.js anatomy viewer (Three.js comes from a pinned CDN URL and is cached by sw.js).
- **sw.js**: offline service worker and caches.

## Storage rules

- IndexedDB stores: `exercises`, `workouts`, `sets`, `meta` (settings, profile), `body`, `prs`. A schema change means bumping `DB_VERSION` and adding an `if (ev.oldVersion < N)` step in `open()`. Never change existing steps: phones upgrade from whatever version they have.
- sessionStorage holds `activeWorkoutId`; localStorage holds `fitMode`. Both go through the try/catch wrappers `ss` and `ls` in app.js.
- Sets keep the unit they were logged in. Convert for display (`dispW`, `convert`) and never rewrite stored data.
- Built-in exercise ids are stable (`ex_bench-press`) so backups merge. Don't rename them.

## Run and check

```bash
python3 tools/serve.py
```

Open http://localhost:5173. To see edits on reload, tick DevTools → Application → Service Workers → **Update on reload**. Service workers don't run from `file://`.

## Shipping

- The live app is GitHub Pages from `main` at https://barnboy19.github.io/liftlog/. Merging or pushing to `main` deploys.
- Every change that ships must bump **both** `VERSION` in sw.js and `APP_VERSION` in js/app.js, keeping them equal (e.g. `v6` → `v7`). Without the sw.js bump, installed phones keep the old cached files.
- Work on a branch and open a PR. Don't push straight to `main` unless asked.
