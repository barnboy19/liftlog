// Tiny promise wrapper around IndexedDB. No dependencies.
// Every write resolves only after its transaction commits, so data is on disk
// before the UI says "logged".

const DB_NAME = 'liftlog';
const DB_VERSION = 1;
export const STORES = ['exercises', 'workouts', 'sets', 'meta'];

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const ex = db.createObjectStore('exercises', { keyPath: 'id' });
      ex.createIndex('name', 'name');
      const wo = db.createObjectStore('workouts', { keyPath: 'id' });
      wo.createIndex('startedAt', 'startedAt');
      const st = db.createObjectStore('sets', { keyPath: 'id' });
      st.createIndex('workoutId', 'workoutId');
      st.createIndex('exerciseId', 'exerciseId');
      st.createIndex('loggedAt', 'loggedAt');
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Run fn(tx) inside one transaction; resolves with fn's request result once committed.
async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    const r = fn(tx);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  get: (store, key) => run(store, 'readonly', (tx) => tx.objectStore(store).get(key)),
  all: (store) => run(store, 'readonly', (tx) => tx.objectStore(store).getAll()),
  byIndex: (store, index, value) =>
    run(store, 'readonly', (tx) => tx.objectStore(store).index(index).getAll(value)),
  put: (store, value) => run(store, 'readwrite', (tx) => tx.objectStore(store).put(value)),
  del: (store, key) => run(store, 'readwrite', (tx) => tx.objectStore(store).delete(key)),
  putMany: (store, values) =>
    run(store, 'readwrite', (tx) => { const s = tx.objectStore(store); values.forEach((v) => s.put(v)); }),
  // Multi-store atomic transaction: fn receives an object of object stores.
  txn: (stores, fn) =>
    run(stores, 'readwrite', (tx) => { fn(Object.fromEntries(stores.map((n) => [n, tx.objectStore(n)]))); }),
  // Walk an index newest-first; cb returns false to stop.
  iterateDesc: async (store, index, cb) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).index(index).openCursor(null, 'prev');
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if (cb(c.value) === false) return;
        c.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};
