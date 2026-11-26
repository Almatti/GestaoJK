import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Send, Sparkles, Database, Bot } from 'lucide-react';
import { db, useList } from '@/data/hooks';
import type { Row } from '@/data/types';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, friendlyError } from '@/components/ui/Feedback';
import { EXAMPLES, matchIntent, sanitizeForAi, type Answer } from './intents';

interface Msg { role: 'user' | 'assistant'; text?: string; answer?: Answer; ai?: string; aiError?: string }

/** Assistente em modo leitura e recomendação. Não executa pagamentos, protestos, exclusões ou cobranças. */
export function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const settings = useList<Row>('settings', { filters: [{ column: 'key', op: 'eq', value: 'ai.enabled' }] });
  const aiEnabled = settings.data?.rows[0]?.value === true && db().mode === 'supabase';
  const end = useRef<HTMLDivElement>(null);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setQ('');
    setBusy(true);
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    const intent = matchIntent(question);
    let msg: Msg;
    if (!intent) {
      msg = { role: 'assistant', text: 'Ainda não sei responder essa pergunta com dados verificáveis. Experimente uma das perguntas sugeridas abaixo.' };
    } else {
      try {
        const answer = await intent.run(db());
        msg = { role: 'assistant', answer };
        if (aiEnabled) {
          try {
            const payload = sanitizeForAi(JSON.stringify({ pergunta: question, resultado: { titulo: answer.title, resumo: answer.summary, tabela: answer.table, periodo: answer.period, limitacoes: answer.limitations } }));
            const r = await db().invoke<{ text: string }>('ai-assistant', { payload });
            msg.ai = r.text;
          } catch (e) {
            msg.aiError = friendlyError(e);
          }
        }
      } catch (e) {
        msg = { role: 'assistant', text: friendlyError(e) };
      }
    }
    setMsgs((m) => [...m, msg]);
    setBusy(false);
    setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Assistente inteligente" subtitle="Analista financeiro, comercial, de marketing e de produtividade — com números calculados por consultas determinísticas ao banco." />
      <div className="mb-4"><Alert tone="info" title={aiEnabled ? 'IA externa habilitada (interpretação)' : 'Modo interno (sem IA externa)'}>
        {aiEnabled ? 'Os cálculos continuam determinísticos. Antes de enviar ao provedor, documentos, e-mails e telefones são removidos. A IA apenas explica e sugere.' : 'O sistema funciona normalmente sem IA. Para interpretações em linguagem natural, configure um provedor em Integrações e habilite em Configurações.'}
      </Alert></div>
      <Card opaque className="min-h-[50dvh]">
        <div className="space-y-4">
          {msgs.length === 0 && (
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 grid size-14 place-items-center rounded-3xl bg-gradient-to-br from-tangerine-500 to-tangerine-800 text-white"><Sparkles className="size-7" /></div>
              <p className="font-display text-lg font-bold">Como posso ajudar?</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">{EXAMPLES.map((e) => <button key={e} onClick={() => ask(e)} className="rounded-full border border-tangerine-200 bg-cream-100 px-3 py-1.5 text-sm hover:bg-tangerine-100">{e}</button>)}</div>
            </div>
          )}
          {msgs.map((m, i) => m.role === 'user' ? (
            <div key={i} className="flex justify-end"><p className="max-w-[80%] rounded-3xl rounded-br-md bg-gradient-to-br from-tangerine-700 to-tangerine-800 px-4 py-2.5 text-sm text-white">{m.text}</p></div>
          ) : (
            <div key={i} className="flex gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-2xl bg-tangerine-100 text-tangerine-900"><Bot className="size-5" /></span>
              <div className="min-w-0 flex-1 space-y-2">
                {m.text && <p className="text-sm">{m.text}</p>}
                {m.answer && (
                  <div className="rounded-2xl border border-tangerine-100 p-4">
                    <p className="font-display font-bold">{m.answer.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{m.answer.summary}</p>
                    {m.answer.table && m.answer.table.rows.length > 0 && (
                      <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-cocoa-700"><tr>{m.answer.table.columns.map((c) => <th key={c} className="py-1.5 pr-3">{c}</th>)}</tr></thead>
                        <tbody>{m.answer.table.rows.map((r, j) => <tr key={j} className="border-t border-tangerine-100">{r.map((c, k) => <td key={k} className="num py-1.5 pr-3">{c}</td>)}</tr>)}</tbody></table></div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-cocoa-700">
                      <Database className="size-3.5" aria-hidden /> Fontes: {m.answer.sources.map((s) => <Badge key={s} icon={false}>{s}</Badge>)}
                      {m.answer.period && <span>· Período: {m.answer.period}</span>}
                    </div>
                    {m.answer.limitations && <p className="mt-1 text-xs text-cocoa-700">Limitações: {m.answer.limitations}</p>}
                    {m.answer.links && <div className="mt-2 flex flex-wrap gap-2">{m.answer.links.map((l) => <Link key={l.to} to={l.to} className="text-sm font-semibold text-tangerine-900 underline">{l.label}</Link>)}</div>}
                  </div>
                )}
                {m.ai && <div className="rounded-2xl bg-cream-100 p-3 text-sm"><p className="mb-1 flex items-center gap-1 text-xs font-semibold text-tangerine-900"><Sparkles className="size-3.5" />Interpretação da IA (verifique antes de agir)</p><p className="whitespace-pre-wrap">{m.ai}</p></div>}
                {m.aiError && <p className="text-xs text-cocoa-700">IA indisponível: {m.aiError}. Resposta acima calculada internamente.</p>}
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
      </Card>
      <form className="glass sticky bottom-24 mt-3 flex gap-2 rounded-[22px] p-2 md:bottom-4" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input className="input border-0 bg-white/80" placeholder="Pergunte sobre clientes, financeiro, estoque, campanhas…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Pergunta" maxLength={500} />
        <Button type="submit" loading={busy} icon={<Send className="size-4" />}>Perguntar</Button>
      </form>
    </div>
  );
}
