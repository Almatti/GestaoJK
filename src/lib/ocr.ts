/**
 * OCR local (Tesseract.js, português) para PDFs digitalizados (páginas de imagem, sem texto).
 * Roda no navegador: o arquivo NÃO sai do aparelho. Motor e idioma ficam em /ocr/ (carregados sob demanda).
 */
export async function ocrPdfLines(file: File, maxPages = 2, onProgress?: (message: string) => void): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const { createWorker } = await import('tesseract.js');
  const ocr = await createWorker('por', 1, {
    workerPath: '/ocr/worker.min.js',
    workerBlobURL: false,
    corePath: '/ocr/',
    langPath: '/ocr/',
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(`Reconhecendo o texto da imagem… ${Math.round(m.progress * 100)}%`);
    }
  });
  const lines: string[] = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      onProgress?.(`Lendo a página ${p} do PDF…`);
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 3 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Este navegador não consegue preparar a imagem do PDF.');
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const { data } = await ocr.recognize(canvas);
      lines.push(...data.text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean));
    }
  } finally {
    await ocr.terminate();
    await doc.destroy();
  }
  return lines;
}
