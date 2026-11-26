import { useEffect, useState } from 'react';
import { MessageCircle, Copy, ExternalLink, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Overlay';
import { Alert, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { renderTemplate, whatsappLink, type TemplateValues } from '@/domain/messages';

/**
 * Envio assistido por link oficial wa.me: o usuário revisa, abre a conversa e CONFIRMA o envio manualmente.
 * Abrir o WhatsApp NÃO é registrado como "enviado".
 */
export function WhatsAppButton({ phone, templateKey, values, text, customerId, refType, refId, small, label = 'WhatsApp' }: {
  phone: string; templateKey?: string; values?: TemplateValues; text?: string; customerId?: string; refType?: string; refId?: string; small?: boolean; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(text ?? '');
  const [missing, setMissing] = useState<string[]>([]);
  const [queueId, setQueueId] = useState<string | null>(null);
  const toast = useToast();
  const invalidate = useInvalidateAll();

  useEffect(() => {
    if (!open || !templateKey) return;
    (async () => {
      const [tpl, company] = await Promise.all([
        db().list<Row>('message_templates', { filters: [{ column: 'key', op: 'eq', value: templateKey }] }),
        db().list<Row>('company', {})
      ]);
      const co = company.rows[0] ?? {};
      const r = renderTemplate(String(tpl.rows[0]?.body ?? ''), { NOME_EMPRESA: String(co.trade_name ?? 'JK CHOPP'), CHAVE_PIX: (co.pix_key as string) ?? undefined, ...values });
      setBody(r.text);
      setMissing(r.missing);
    })().catch((e) => toast(friendlyError(e), 'danger'));
  }, [open, templateKey, values, toast]);

  const link = whatsappLink(phone, body);

  const record = async (status: 'aberta' | 'envio_informado') => {
    try {
      if (!queueId) {
        const q = await db().insert<Row>('message_queue', { template_key: templateKey ?? null, customer_id: customerId ?? null, phone, body, ref_type: refType ?? null, ref_id: refId ?? null, status, opened_at: new Date().toISOString(), reported_sent_at: status === 'envio_informado' ? new Date().toISOString() : null });
        setQueueId(String(q.id));
      } else {
        await db().update('message_queue', queueId, { status, ...(status === 'envio_informado' ? { reported_sent_at: new Date().toISOString() } : {}) });
      }
      invalidate();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <>
      <Button variant="soft" size={small ? 'sm' : 'md'} icon={<MessageCircle className="size-4" />} onClick={() => { setQueueId(null); setOpen(true); }} disabled={!phone}>{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Mensagem pelo WhatsApp" description="Revise o texto. O envio é feito por você no WhatsApp (link oficial)." size="md"
        footer={<>
          <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(body).then(() => toast('Mensagem copiada.'))}>Copiar</Button>
          <Button variant="secondary" icon={<ExternalLink className="size-4" />} disabled={!link} onClick={() => { if (link) { window.open(link, '_blank', 'noopener'); record('aberta'); } }}>Abrir WhatsApp</Button>
          <Button icon={<CheckCheck className="size-4" />} disabled={!queueId} onClick={async () => { await record('envio_informado'); toast('Envio informado registrado.'); setOpen(false); }}>Informar envio</Button>
        </>}>
        {!link && <div className="mb-3"><Alert tone="danger">Telefone inválido ou não cadastrado para este cliente.</Alert></div>}
        {missing.length > 0 && <div className="mb-3"><Alert tone="warning" title="Variáveis sem valor">{missing.map((m) => `[${m}]`).join(', ')} — edite o texto antes de enviar.</Alert></div>}
        <label className="label" htmlFor="wa-body">Mensagem</label>
        <textarea id="wa-body" className="input min-h-44" value={body} onChange={(e) => setBody(e.target.value)} />
        <p className="hint">“Abrir WhatsApp” registra a mensagem como <strong>aberta</strong>. Só marque “Informar envio” depois de enviar de fato.</p>
      </Modal>
    </>
  );
}
