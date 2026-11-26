/** Leitor de extratos OFX (SGML 1.x ou XML 2.x) — extrai transações para conciliação manual assistida. */
export interface OfxTransaction { fitId: string; date: string; amount: number; memo: string; type: string }

const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block);
  return m ? m[1]!.trim() : '';
};

export function parseOfx(content: string): OfxTransaction[] {
  const blocks = content.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]!);
  return blocks
    .map((b) => {
      const d = tag(b, 'DTPOSTED');
      return {
        fitId: tag(b, 'FITID'),
        date: d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '',
        amount: Number(tag(b, 'TRNAMT').replace(',', '.')),
        memo: tag(b, 'MEMO') || tag(b, 'NAME'),
        type: tag(b, 'TRNTYPE')
      };
    })
    .filter((t) => t.date && Number.isFinite(t.amount));
}

/** Sugere correspondência por valor e data (±3 dias). */
export function matchTransactions<T extends { id: string; amount: number; occurred_on: string; reconciled?: boolean }>(ofx: OfxTransaction[], internal: T[]) {
  const used = new Set<string>();
  return ofx.map((o) => {
    const m = internal.find((t) => !used.has(t.id) && !t.reconciled && Math.abs(t.amount - o.amount) < 0.005 && Math.abs(Date.parse(t.occurred_on) - Date.parse(o.date)) <= 3 * 864e5);
    if (m) used.add(m.id);
    return { ofx: o, match: m ?? null };
  });
}
