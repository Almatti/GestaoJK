/** Exportações sem dependências externas: CSV (Excel pt-BR), planilha .xls (HTML) e PDF via impressão do navegador. */
import { formatCell, type CellFormat } from './format';

export interface ExportColumn {
  key: string;
  label: string;
  format?: CellFormat;
  value?: (row: Record<string, unknown>) => unknown;
}

const cell = (row: Record<string, unknown>, c: ExportColumn) => (c.value ? c.value(row) : row[c.key]);

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: Record<string, unknown>[], cols: ExportColumn[]): string {
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const raw = (r: Record<string, unknown>, c: ExportColumn) => {
    const v = cell(r, c);
    if (v === null || v === undefined) return '';
    if (c.format === 'money' || c.format === 'number' || c.format === 'liters' || c.format === 'percent') return String(v).replace('.', ',');
    return c.format ? formatCell(v, c.format) : String(v);
  };
  return '﻿' + [cols.map((c) => esc(c.label)).join(';'), ...rows.map((r) => cols.map((c) => esc(raw(r, c))).join(';'))].join('\r\n');
}

export function exportCsv(name: string, rows: Record<string, unknown>[], cols: ExportColumn[]) {
  download(`${name}.csv`, toCsv(rows, cols), 'text/csv;charset=utf-8');
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function htmlTable(title: string, rows: Record<string, unknown>[], cols: ExportColumn[]) {
  return `<table><caption>${escHtml(title)}</caption><thead><tr>${cols.map((c) => `<th>${escHtml(c.label)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${cols.map((c) => `<td>${escHtml(formatCell(cell(r, c), c.format))}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

export function exportExcel(name: string, rows: Record<string, unknown>[], cols: ExportColumn[]) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>${htmlTable(name, rows, cols)}</body></html>`;
  download(`${name}.xls`, html, 'application/vnd.ms-excel');
}

/** Abre uma janela de impressão formatada (o usuário escolhe "Salvar como PDF"). */
export function printDocument(title: string, bodyHtml: string) {
  const w = window.open('', '_blank', 'noopener=no,width=900,height=700');
  if (!w) throw new Error('O navegador bloqueou a janela de impressão. Permita pop-ups para este site.');
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>body{font-family:Inter,system-ui,sans-serif;color:#2b1a12;margin:32px;font-size:12px}h1{font-size:18px;color:#a63900}
table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #f1c9a5;padding:6px 8px;text-align:left}th{background:#fff1e4}
caption{text-align:left;font-weight:700;margin-bottom:6px}.doc{white-space:pre-wrap;font-size:13px;line-height:1.6}footer{margin-top:24px;color:#92543a;font-size:10px}</style>
</head><body>${bodyHtml}<footer>Gerado por JK CHOPP GESTÃO em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</footer>
<script>window.onload=()=>{window.print()}</script></body></html>`);
  w.document.close();
}

export function exportPdf(title: string, rows: Record<string, unknown>[], cols: ExportColumn[]) {
  printDocument(title, `<h1>${escHtml(title)}</h1>${htmlTable(title, rows, cols)}`);
}

export { escHtml };
