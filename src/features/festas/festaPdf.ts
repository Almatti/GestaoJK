/**
 * Documentos de impressão do módulo Festas (identidade JK CHOPP). Geram HTML; a impressão/"Salvar como PDF"
 * usa o recurso do navegador (printDocument), sem serviço externo.
 */
import { printDocument } from '@/lib/export';
import { formatDateBR } from '@/domain/dates';
import { formatNumber } from '@/domain/money';
import type { PlanningGroup } from '@/domain/festas';

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const BOX = '<span style="display:inline-block;width:14px;height:14px;border:1.5px solid #69351f;border-radius:3px"></span>';
const LINE = '<span style="display:inline-block;min-width:120px;border-bottom:1px solid #69351f">&nbsp;</span>';

function header(title: string, subtitle: string) {
  return `<div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #fc6500;padding-bottom:8px;margin-bottom:14px">
  <div><div style="font-family:Manrope,system-ui,sans-serif;font-size:22px;font-weight:800;color:#a63900;letter-spacing:.5px">JK CHOPP</div>
  <div style="font-size:11px;color:#92543a;letter-spacing:2px;text-transform:uppercase">Gestão de festas</div></div>
  <div style="text-align:right"><div style="font-size:16px;font-weight:700;color:#69351f">${esc(title)}</div><div style="font-size:11px;color:#92543a">${esc(subtitle)}</div></div>
</div>`;
}

/** Lista consolidada de compras: agrupada por produto e litragem, com quantidades e campos de conferência. */
export function purchaseListHtml(p: { from: string; to: string; groups: PlanningGroup[] }): string {
  const period = `${formatDateBR(p.from)} a ${formatDateBR(p.to)}`;
  const totalLiters = p.groups.reduce((s, g) => s + (g.liters ?? 0), 0);
  const rows = p.groups.map((g) => `<tr>
    <td><strong>${esc(g.product)}</strong></td>
    <td style="text-align:right">${g.kegLiters ? `${formatNumber(g.kegLiters)} L` : '—'}</td>
    <td style="text-align:right">${formatNumber(g.quantity, 2)} ${g.unit === 'barril' ? 'barril(is)' : esc(g.unit)}</td>
    <td style="text-align:right">${g.liters != null ? `${formatNumber(g.liters, 1)} L` : '—'}</td>
    <td style="text-align:right">${formatNumber(g.purchased, 2)}</td>
    <td style="text-align:right"><strong>${formatNumber(g.missing, 2)}</strong></td>
    <td style="font-size:10px">${g.events.map((e) => `${esc(e.code)} · ${esc(e.name)} (${formatDateBR(e.date)}): ${formatNumber(e.quantity, 2)}`).join('<br>')}</td>
    <td style="text-align:center">${BOX} comprado<br>${BOX} separado<br>${BOX} conferido</td>
  </tr>`).join('');
  return `${header('Lista consolidada de compras', `Período: ${period}`)}
<table><thead><tr><th>Produto</th><th>Litragem</th><th>Quantidade necessária</th><th>Total de litros</th><th>Já comprado</th><th>Ainda necessário</th><th>Eventos</th><th>Conferência</th></tr></thead>
<tbody>${rows || '<tr><td colspan="8" style="text-align:center">Nenhum item de festa no período.</td></tr>'}</tbody>
<tfoot><tr><th colspan="3">Total</th><th style="text-align:right">${formatNumber(totalLiters, 1)} L</th><th colspan="4"></th></tr></tfoot></table>
<p style="margin-top:14px;font-size:11px;color:#92543a">Quantidades de barris e litros conforme os pedidos das festas no período. Confira o estoque antes de comprar.</p>
<div style="margin-top:28px;font-size:12px">Responsável pela compra: ${LINE} &nbsp;&nbsp; Data: ${LINE}</div>`;
}

export interface ChecklistEvent {
  code: string; name: string; client: string; phone: string; date: string; time: string; address: string; notes: string;
}
export interface ChecklistItem {
  product: string; unit: string; keg_liters: number | null; quantity: number; notes: string;
}

/** Checklist individual do evento: cliente, data, produtos, quantidades e campos de conferência. */
export function eventChecklistHtml(ev: ChecklistEvent, items: ChecklistItem[]): string {
  const rows = items.map((i) => `<tr>
    <td><strong>${esc(i.product || '(sem nome)')}</strong>${i.notes ? `<br><span style="font-size:10px;color:#92543a">${esc(i.notes)}</span>` : ''}</td>
    <td>${esc(i.unit)}</td>
    <td style="text-align:right">${i.keg_liters ? `${formatNumber(i.keg_liters)} L` : '—'}</td>
    <td style="text-align:right"><strong>${formatNumber(i.quantity, 2)}</strong></td>
    <td style="text-align:center">${BOX}</td><td style="text-align:center">${BOX}</td><td style="text-align:center">${BOX}</td>
  </tr>`).join('');
  return `${header('Checklist do evento', `${esc(ev.code)} · impresso em ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`)}
<table style="margin-bottom:12px"><tbody>
  <tr><th style="width:18%">Cliente</th><td>${esc(ev.client || '—')}</td><th style="width:18%">Telefone</th><td>${esc(ev.phone || '—')}</td></tr>
  <tr><th>Evento</th><td>${esc(ev.name || '—')}</td><th>Data / horário</th><td>${formatDateBR(ev.date) || '—'} ${esc(ev.time)}</td></tr>
  <tr><th>Endereço</th><td colspan="3">${esc(ev.address || '—')}</td></tr>
  ${ev.notes ? `<tr><th>Observações</th><td colspan="3">${esc(ev.notes)}</td></tr>` : ''}
</tbody></table>
<table><thead><tr><th>Produto</th><th>Unidade</th><th>Litragem</th><th>Quantidade</th><th>Separado</th><th>Carregado</th><th>Conferido</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7" style="text-align:center">Sem produtos cadastrados.</td></tr>'}</tbody></table>
<div style="margin-top:22px;font-size:12px">Conferido por: ${LINE} &nbsp;&nbsp; Data/hora: ${LINE}</div>
<div style="margin-top:14px;font-size:11px">Observações da conferência:</div>
<div style="border-bottom:1px solid #b07a60;height:22px"></div><div style="border-bottom:1px solid #b07a60;height:22px"></div>`;
}

export function printPurchaseList(p: { from: string; to: string; groups: PlanningGroup[] }) {
  printDocument(`Lista de compras ${formatDateBR(p.from)} a ${formatDateBR(p.to)}`, purchaseListHtml(p));
}

export function printEventChecklist(ev: ChecklistEvent, items: ChecklistItem[]) {
  printDocument(`Checklist ${ev.code}`, eventChecklistHtml(ev, items));
}
