/**
 * Extrai o texto de um PDF no próprio navegador (pdf.js). O arquivo NÃO é enviado a terceiros.
 * Carregado sob demanda para não pesar no carregamento inicial do app.
 */
export async function extractPdfText(file: File, maxPages = 3): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    parts.push(content.items.map((i) => ('str' in i ? i.str : '')).join(' '));
  }
  await doc.destroy();
  return parts.join('\n');
}
