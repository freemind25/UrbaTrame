/* MapToNap-clone · persistance
   Cache IndexedDB indexé par le texte de la requête Overpass, réutilisé en cas
   d'échec réseau — comportement repris du client analysé (mtn-2d-client.js).
   Préférences UI dans localStorage. */

const DB = 'mtn_cache', STORE = 'queries', TTL = 7 * 864e5;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }).catch(() => null);      // mode privé : pas de cache, l'app continue
  return dbp;
}
const key = q => 'q_' + q.length + '_' + simpleHash(q);
function simpleHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
export async function cacheGet(q) {
  const db = await open(); if (!db) return null;
  return new Promise(res => {
    const tx = db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).get(key(q));
    rq.onsuccess = () => {
      const v = rq.result;
      if (v && Date.now() - v.t < TTL) res(v); else res(null);
    };
    rq.onerror = () => res(null);
  });
}
export async function cachePut(q, data) {
  const db = await open(); if (!db) return;
  return new Promise(res => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ t: Date.now(), d: data }, key(q));
    tx.oncomplete = () => res(true);
    tx.onerror = () => res(false);
  });
}
export async function cacheClear() {
  const db = await open(); if (!db) return;
  return new Promise(res => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => res(true);
  });
}
export const hoursSince = t => Math.round((Date.now() - t) / 36e5);

/* ── préférences ── */
const k = n => 'mtn_' + n;
export const store = {
  get(n, d) { try { const v = localStorage.getItem(k(n)); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(n, v) { try { v === null ? localStorage.removeItem(k(n)) : localStorage.setItem(k(n), JSON.stringify(v)); } catch {} },
  del(n) { try { localStorage.removeItem(k(n)); } catch {} }
};
export function deviceId() {
  let d = store.get('device');
  if (!d) {
    d = (crypto.randomUUID ? crypto.randomUUID() : 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
    store.set('device', d);
  }
  if (!/^[0-9a-f-]{16,40}$/i.test(d)) { d = crypto.randomUUID(); store.set('device', d); }
  return d;
}
