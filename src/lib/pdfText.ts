/**
 * Extrai o texto de um PDF no próprio navegador (pdf.js), com a POSIÇÃO de cada trecho na página.
 * O arquivo NÃO é enviado a terceiros. Carregado sob demanda para não pesar no carregamento inicial.
 */
import type { PdfTextItem } from '@/domain/boleto';

export async function extractPdf(file: File, maxPages = 3): Promise<{ text: string; items: PdfTextItem[] }> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const parts: string[] = [];
  const items: PdfTextItem[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const i of content.items) {
      if (!('str' in i) || !i.str.trim()) continue;
      const [, , , d, x, y] = i.transform as number[];
      items.push({ str: i.str.trim(), x: x ?? 0, y: y ?? 0, w: i.width ?? 0, h: Math.abs(d ?? 0) || i.height || 8, page: p });
    }
    parts.push(content.items.map((i) => ('str' in i ? i.str : '')).join(' '));
  }
  await doc.destroy();
  return { text: parts.join('\n'), items };
}

/** Compatibilidade: somente o texto. */
export async function extractPdfText(file: File, maxPages = 3): Promise<string> {
  return (await extractPdf(file, maxPages)).text;
}
