/**
 * Compartilha o PDF do boleto junto com a mensagem de cobrança pelo recurso de compartilhamento do aparelho
 * (no celular abre a janela para escolher WhatsApp e o cliente, com o PDF anexado).
 * Sem suporte (computador), baixa o PDF e abre a conversa com a mensagem para anexar manualmente.
 */
import { db } from '@/data/hooks';
import { whatsappLink } from '@/domain/messages';

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

export async function sharePdfWithMessage(opts: { storagePath: string; fileName: string; text: string; phone?: string | null }): Promise<ShareResult> {
  const url = await db().storage.signedUrl(opts.storagePath, 300);
  const blob = await (await fetch(url)).blob();
  const file = new File([blob], opts.fileName, { type: 'application/pdf' });

  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: opts.text, title: 'Cobrança' });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      throw e;
    }
  }

  // Computador: baixa o PDF e abre a conversa com a mensagem; o PDF é anexado manualmente.
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: opts.fileName });
  document.body.appendChild(a);
  a.click();
  a.remove();
  const link = opts.phone ? whatsappLink(opts.phone, opts.text) : null;
  if (link) window.open(link, '_blank', 'noopener');
  return 'downloaded';
}
