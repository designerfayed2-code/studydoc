// OCR for scanned pages - free, local, offline. Renders a page with pdf.js and reads it with Tesseract
// (Arabic + English). All engine files live in this folder; nothing is sent to any server.
export const OCR_LANGS = 'ara+eng';
export const OCR_SCALE = 2.2;

// Tesseract emits invisible bidi marks around mixed Arabic/Latin text; they would break word matching.
export function cleanOcrText(text) {
  return String(text || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function makeOcr(worker, makeCanvas, scale = OCR_SCALE) {
  return {
    async pageText(page) {
      const viewport = page.getViewport({ scale });
      const canvas = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
      const input = canvas.toBuffer ? canvas.toBuffer('image/png') : canvas; // Node canvas vs browser canvas
      const { data } = await worker.recognize(input);
      canvas.width = 0; canvas.height = 0; // release the bitmap memory (matters on phones)
      return cleanOcrText(data.text);
    },
    dispose: () => worker.terminate(),
  };
}

// Keep the ORIGINAL error (message + cause) and print it to the console - never hide it behind a generic text.
function failure(stage, e) {
  const err = new Error(`${stage}: ${(e && e.message) || e}`);
  err.cause = e;
  console.error(`[StudyDoc OCR] failed while ${stage}:`, e);
  return err;
}

export async function createBrowserOcr(onStatus = () => {}) {
  let lib;
  try {
    lib = await import('./tesseract.esm.min.js');
  } catch (e) { throw failure('loading tesseract.esm.min.js', e); }
  // IMPORTANT: this bundle has only a DEFAULT export (the Tesseract object). `lib.createWorker` /
  // `import { createWorker }` do NOT exist - using them was the bug that made OCR fail before any download.
  const Tesseract = lib.default || lib;
  if (typeof Tesseract.createWorker !== 'function') throw failure('finding createWorker', new Error('unexpected tesseract.esm.min.js build'));
  const base = new URL('./', import.meta.url).href; // absolute URL of this folder (works on GitHub Pages sub-paths)
  try {
    const worker = await Tesseract.createWorker(OCR_LANGS, 1, {
      workerPath: base + 'tesseract-worker.min.js', // blob importScripts() needs an ABSOLUTE url
      corePath: base,                               // folder: the worker picks tesseract-core[-simd|-relaxedsimd]-lstm.wasm.js
      langPath: base,                               // folder: fetches <lang>.traineddata.gz
      gzip: true,
      logger: (m) => { onStatus(m); console.debug('[StudyDoc OCR]', m.status, Math.round((m.progress || 0) * 100) + '%'); },
      errorHandler: (e) => console.error('[StudyDoc OCR worker]', e),
    });
    return makeOcr(worker, (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
  } catch (e) { throw failure('starting the OCR worker (worker / core / language files)', e); }
}
