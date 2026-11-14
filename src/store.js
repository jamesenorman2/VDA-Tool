// Browser storage: the project JSON in localStorage, large blobs (plan images) in IndexedDB.

const DB = 'vda-tool', STORE = 'blobs';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const putBlob = (key, blob) => tx('readwrite', (s) => s.put(blob, key)).catch(() => undefined);
export const getBlob = (key) => tx('readonly', (s) => s.get(key)).catch(() => undefined);
export const deleteBlob = (key) => tx('readwrite', (s) => s.delete(key)).catch(() => undefined);

export function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
export function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob);
});
export const dataURLToBlob = (url) => fetch(url).then((r) => r.blob());
