// PDF reading with pdf.js (bundled locally, so it works offline). Page-by-page, with progress.
import { randomId } from './store.js';

export const MIN_CHARS_PER_PAGE = 25;
export class PdfError extends Error {
  constructor(code, detail = '', cause = undefined) { super(code + (detail ? `: ${detail}` : '')); this.code = code; this.detail = detail; this.cause = cause; }
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

// opts.ocr: async () => ({ pageText(page), dispose() })  - when given, pages with no text are read by OCR.
// opts.signal: { cancelled: bool }, opts.onOcr(done, total)
export async function extractPdf(buf, name, pdfjs, onProgress = () => {}, opts = {}) {
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
  let unreadable = [];
  const ocrPages = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      if (opts.signal?.cancelled) throw new PdfError('cancelled');
      const page = await pdf.getPage(i);
      const text = itemsToText((await page.getTextContent()).items);
      page.cleanup();
      if (text.length < MIN_CHARS_PER_PAGE) unreadable.push(i);
      pages.push({ page: i, text });
      onProgress(i, pdf.numPages);
    }
    if (unreadable.length && opts.ocr) {
      let engine = null;
      try { engine = await opts.ocr(); } catch (e) {
        console.error('[StudyDoc] OCR engine could not start:', e);
        if (unreadable.length === pages.length) throw new PdfError('ocrFailed', String((e && e.message) || e), e);
      }
      if (engine) {
        try {
          const todo = [...unreadable];
          for (let k = 0; k < todo.length; k++) {
            if (opts.signal?.cancelled) throw new PdfError('cancelled');
            opts.onOcr?.(k + 1, todo.length);
            const page = await pdf.getPage(todo[k]);
            const text = await engine.pageText(page);
            page.cleanup();
            if (opts.signal?.cancelled) throw new PdfError('cancelled');
            if (text.length >= MIN_CHARS_PER_PAGE) { pages[todo[k] - 1].text = text; ocrPages.push(todo[k]); }
          }
          unreadable = unreadable.filter((n) => !ocrPages.includes(n));
        } finally { try { await engine.dispose?.(); } catch { /* ignore */ } }
      }
    }
  } finally {
    try { await task.destroy(); } catch { /* ignore */ }
  }
  if (!pages.length) throw new PdfError('empty');
  if (unreadable.length === pages.length) throw new PdfError(opts.ocr ? 'noTextOcr' : 'noText');
  const chars = pages.reduce((a, p) => a + p.text.length, 0);
  return {
    id: randomId(10), name, sha1: await hashBytes(buf), n_pages: pages.length, n_chars: chars,
    est_tokens: Math.floor(chars / 3.5) + 1, unreadable_pages: unreadable, ocr_pages: ocrPages, added_at: Date.now(), pages,
  };
}
