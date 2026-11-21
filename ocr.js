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

export async function createBrowserOcr() {
  const lib = await import('./tesseract.esm.min.js');
  const base = new URL('./', import.meta.url).href;
  const worker = await lib.createWorker(OCR_LANGS, 1, {
    workerPath: base + 'tesseract-worker.min.js', corePath: base, langPath: base, gzip: true,
  });
  return makeOcr(worker, (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
}
