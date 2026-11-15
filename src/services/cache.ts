/* ==========================================================================
   Tiny IndexedDB key-value cache with size-bounded eviction (oldest first).
   Falls back to an in-memory Map when IndexedDB is unavailable (private
   windows, blocked storage). Never throws to callers.
   ========================================================================== */

const DB_NAME = "earthscope-cache";
const STORE = "kv";
const MAX_ENTRIES = 1500;

const memory = new Map<string, unknown>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: "k" });
          s.createIndex("ts", "ts");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  if (memory.has(key)) return memory.get(key) as T;
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result?.v as T | undefined;
        if (v !== undefined) memory.set(key, v);
        resolve(v);
      };
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ k: key, v: value, ts: Date.now() });
    tx.oncomplete = () => void prune(db);
  } catch {
    /* storage full or blocked — memory cache still works */
  }
}

async function prune(db: IDBDatabase) {
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const countReq = store.count();
    countReq.onsuccess = () => {
      const excess = countReq.result - MAX_ENTRIES;
      if (excess <= 0) return;
      let removed = 0;
      const cur = store.index("ts").openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || removed >= excess) return;
        c.delete();
        removed++;
        c.continue();
      };
    };
  } catch {
    /* ignore */
  }
}
