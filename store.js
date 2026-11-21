// Session + document storage in the browser (IndexedDB). Everything stays on the device.
let dbPromise = null;

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('studydoc', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('sessions', { keyPath: 'id' });
      r.result.createObjectStore('docs', { keyPath: 'key' }).createIndex('sid', 'sid');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const db = () => dbPromise || (dbPromise = open());
export function resetConnection() { dbPromise = null; }

const wrap = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

async function run(storeNames, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(storeNames, mode);
    const stores = storeNames.map((s) => t.objectStore(s));
    let out;
    fn(...stores).then((v) => { out = v; }, reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const randomId = (n) => [...crypto.getRandomValues(new Uint8Array(Math.ceil(n / 2)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, n);

export async function createSession(title = 'New study session') {
  const now = Date.now();
  const s = { id: randomId(12), title, created: now, updated: now, doc_ids: [], messages: [] };
  await run(['sessions'], 'readwrite', (st) => wrap(st.put(s)));
  return s;
}
export const loadSession = (id) => run(['sessions'], 'readonly', (st) => wrap(st.get(id)));
export async function saveSession(s) {
  s.updated = Date.now();
  await run(['sessions'], 'readwrite', (st) => wrap(st.put(s)));
}
export async function listSessions() {
  const all = await run(['sessions'], 'readonly', (st) => wrap(st.getAll()));
  return all.map((s) => ({ id: s.id, title: s.title, updated: s.updated, n_messages: s.messages.length, n_docs: s.doc_ids.length }))
    .sort((a, b) => b.updated - a.updated);
}
export async function deleteSession(id) {
  await run(['sessions', 'docs'], 'readwrite', async (ss, ds) => {
    const keys = await wrap(ds.index('sid').getAllKeys(id));
    keys.forEach((k) => ds.delete(k));
    ss.delete(id);
  });
}

export function uniqueName(name, existing) {
  if (!existing.includes(name)) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let i = 2;
  while (existing.includes(`${stem} (${i})${ext}`)) i++;
  return `${stem} (${i})${ext}`;
}

export async function loadDocuments(session) {
  const out = [];
  for (const id of session.doc_ids) {
    const d = await run(['docs'], 'readonly', (st) => wrap(st.get(`${session.id}:${id}`)));
    if (d) out.push(d);
  }
  return out;
}
export async function addDocument(session, doc, existingNames) {
  doc.name = uniqueName(doc.name, existingNames);
  await run(['docs'], 'readwrite', (st) => wrap(st.put({ ...doc, key: `${session.id}:${doc.id}`, sid: session.id })));
  session.doc_ids.push(doc.id);
  await saveSession(session);
  return doc;
}
export async function removeDocument(session, docId) {
  await run(['docs'], 'readwrite', (st) => wrap(st.delete(`${session.id}:${docId}`)));
  session.doc_ids = session.doc_ids.filter((d) => d !== docId);
  await saveSession(session);
}
