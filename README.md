# LiftLog

A fast, offline workout tracker that installs to your phone's home screen. You log exercises as sets of weight × reps, and every set is timestamped. All data stays on your device in IndexedDB. There's no account and no server.

Plain HTML/CSS/JS with no build step and no dependencies.

```
index.html            app shell + bottom nav
manifest.webmanifest  PWA manifest (standalone, dark)
sw.js                 offline service worker
css/app.css           styles
js/db.js              tiny IndexedDB wrapper
js/data.js            seed exercises, queries, formatting, backup
js/app.js             screens and interactions
icons/                app icons (regenerate: python3 tools/make_icons.py)
```

## Run it locally

Any static file server works. From this folder:

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173. Service workers only run on `localhost` or HTTPS, so opening `index.html` as a file won't work.

**While developing:** the service worker serves files from its cache, so your edits won't show up on reload. In Chrome DevTools → Application → Service Workers, tick **Update on reload**, or bump `VERSION` in `sw.js`.

## Deploy (free, HTTPS)

Your phone needs an HTTPS URL to install the app. Pick one:

### Netlify (easiest, no git needed)
1. Go to https://app.netlify.com/drop and sign in.
2. Drag this whole folder onto the page.
3. You get a URL like `https://something.netlify.app`. Rename it under **Site configuration → Change site name**.
4. To update later, open your site → **Deploys** → drag the folder in again.

### GitHub Pages
1. Create a new repository on GitHub, e.g. `liftlog`.
2. Push this folder to it:
   ```bash
   git init && git add . && git commit -m "LiftLog"
   git branch -M main
   git remote add origin https://github.com/<you>/liftlog.git
   git push -u origin main
   ```
3. In the repo go to **Settings → Pages → Build and deployment**. Set Source to **Deploy from a branch**, Branch `main`, folder `/ (root)`, then **Save**.
4. After a minute the app is live at `https://<you>.github.io/liftlog/`. All paths are relative, so the subfolder works.

### Shipping an update
1. Change the files.
2. **Bump `VERSION` in `sw.js`** (e.g. `v1` → `v2`). Without this, installed phones keep the old cached version.
3. Deploy again. Next time the app opens, it fetches the new version and shows an "App updated · Reload" banner.

## Install on your phone

Open the deployed URL once while online. After that the app works fully offline.

**iPhone (Safari only; other iOS browsers can't install PWAs on older iOS):**
1. Open the URL in **Safari**.
2. Tap the **Share** button (square with an up arrow).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Launch it from the home screen icon. It opens full-screen without Safari's address bar.

**Android (Chrome):**
1. Open the URL in **Chrome**.
2. Tap **Install app** in the banner, or **⋮ → Add to Home screen / Install app**.
3. Launch it from the home screen or app drawer.

## Back up your data (important)

Your workouts exist **only on that phone**. Deleting the app, clearing Safari or Chrome website data, or losing the phone erases them. So:

- **Settings → Export backup (JSON)** saves everything (exercises, workouts, sets, settings). On a phone this opens the share sheet. Save it to Files or iCloud Drive or Google Drive, or email it to yourself. Do this every week or two.
- **Settings → Import backup…** loads a backup file. Importing *merges* with what's already there: entries with the same id are updated and nothing else is touched. You can also use this to move your data to a new phone.
- **Settings → Export CSV** gives you one row per set (date, time, exercise, weight, unit, reps, estimated 1RM) for Excel or Google Sheets. It's a read-only export and can't be imported back. Use JSON for backups.
- On first launch from the home screen, the app asks the browser for **persistent storage** so the data isn't evicted to free space. Settings shows whether that was granted. On iPhone, apps added to the home screen are exempt from Safari's 7-day storage cleanup. That's one more reason to install the app rather than use it in a browser tab.

## How it works

- **Start Workout** creates a workout stamped with the current time. If you open the app while today's workout is still open, it offers **Continue Workout**. An unfinished workout from an earlier day can be finished from the home screen, and its end time is set to its last set.
- **Logging:** the weight and reps prefill from your last set of that exercise today, or from the first set of your last session. Use the big **−/+** buttons (weight step is set in Settings) or tap a number to type it. **Repeat** logs the previous set again with one tap. Your phone vibrates on Android; iOS doesn't support web vibration.
- **Edit or delete a set:** tap it to edit, or swipe it left to delete (with Undo).
- **"Last time: 185 × 8, 8, 6 (Nov 18)"** under each exercise shows what to beat. A **PR** badge appears when a set beats your best estimated 1RM from before today.
- **Estimated 1RM** uses Epley: `weight × (1 + reps / 30)`. A single rep counts as its own 1RM.
- **Units:** each set stores the unit it was logged in. Switching between lb and kg converts what's displayed and never rewrites your data.

## Data model (IndexedDB `liftlog`)

| store | fields |
|---|---|
| `exercises` | id, name, category, createdAt, builtin? |
| `workouts` | id, startedAt, endedAt, notes, exerciseOrder[] |
| `sets` | id, workoutId, exerciseId, weight, reps, unit, loggedAt, order |
| `meta` | settings, seeded flag |

Timestamps are ISO-8601 strings. Built-in exercises have stable ids (`ex_bench-press`), so backups from different devices merge without creating duplicates.
