// PDF reading with pdf.js (bundled locally, so it works offline). Page-by-page, with progress.
import { randomId } from './store.js';

export const MIN_CHARS_PER_PAGE = 25;
export class PdfError extends Error {
  constructor(code, detail = '') { super(code + (detail ? `: ${detail}` : '')); this.code = code; }
}

let pdfjsPromise = null;
export function getPdfjs() {
  return (pdfjsPromise ||= import('./pdf.min.js').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.js', import.meta.url).href;
    return lib;
  }));
}

export async function hashBytes(buf) {
  if (globalThis.crypto?.subtle) {
    const d = await crypto.subtle.digest('SHA-1', buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0x811c9dc5; // fallback (insecure context): FNV-1a
  for (const b of new Uint8Array(buf)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return 'fnv' + h.toString(16) + buf.byteLength;
}

export function itemsToText(items) {
  let out = '';
  let prev = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    if (prev) {
      const sameLine = Math.abs(it.transform[5] - prev.transform[5]) < Math.max(prev.height, 1) * 0.5;
      if (!sameLine && !out.endsWith('\n')) out += '\n';
      else if (sameLine) {
        const gap = it.transform[4] - (prev.transform[4] + prev.width);
        if (gap > Math.max(prev.height, 1) * 0.15 && !out.endsWith(' ') && !it.str.startsWith(' ')) out += ' ';
      }
    }
    out += it.str;
    if (it.hasEOL && !out.endsWith('\n')) out += '\n';
    prev = it;
  }
  return out.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractPdf(buf, name, pdfjs, onProgress = () => {}) {
  if (!buf || !buf.byteLength) throw new PdfError('empty');
  let pdf;
  const task = pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false });
  try {
    pdf = await task.promise;
  } catch (e) {
    try { task.destroy(); } catch { /* ignore */ }
    throw new PdfError(e && e.name === 'PasswordException' ? 'password' : 'unreadable', String(e && e.message));
  }
  const pages = [];
  const unreadable = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const text = itemsToText((await page.getTextContent()).items);
      page.cleanup();
      if (text.length < MIN_CHARS_PER_PAGE) unreadable.push(i);
      pages.push({ page: i, text });
      onProgress(i, pdf.numPages);
    }
  } finally {
    try { await task.destroy(); } catch { /* ignore */ }
  }
  if (!pages.length) throw new PdfError('empty');
  if (unreadable.length === pages.length) throw new PdfError('noText');
  const chars = pages.reduce((a, p) => a + p.text.length, 0);
  return {
    id: randomId(10), name, sha1: await hashBytes(buf), n_pages: pages.length, n_chars: chars,
    est_tokens: Math.floor(chars / 3.5) + 1, unreadable_pages: unreadable, added_at: Date.now(), pages,
  };
}
