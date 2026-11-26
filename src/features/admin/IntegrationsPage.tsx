import { ExternalLink, Plug, RefreshCw, Unplug } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import type { Tone } from '@/domain/collections';
import { formatDateTimeBR } from '@/domain/dates';

const STATUS: Record<string, [string, Tone]> = { nao_configurada: ['Não configurada', 'neutral'], aguardando_autorizacao: ['Aguardando autorização', 'warning'], conectada: ['Conectada', 'success'], desconectada: ['Desconectada', 'neutral'], sincronizacao_pendente: ['Sincronização pendente', 'warning'], erro: ['Erro', 'danger'], limite_atingido: ['Limite atingido', 'danger'] };

/** Instruções verificadas nas documentações oficiais. Nada é contratado ou habilitado automaticamente. */
const INFO: Record<string, { what: string; how: string; cost: string; docs: string; action?: 'google' }> = {
  supabase: { what: 'Banco PostgreSQL, autenticação, armazenamento privado, Edge Functions e agendamentos.', how: 'Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY e aplique as migrations (DEPLOYMENT.md).', cost: 'Plano gratuito com limites (projetos inativos podem ser pausados). Verifique cotas atuais.', docs: 'https://supabase.com/docs' },
  github: { what: 'Versionamento do código e CI.', how: 'Repositório já configurado.', cost: 'Gratuito para repositórios privados com limites de Actions.', docs: 'https://docs.github.com' },
  cloudflare: { what: 'Hospedagem do frontend (Cloudflare Pages).', how: 'Conecte o repositório no painel do Cloudflare Pages (build: npm run build, saída: dist).', cost: 'Plano gratuito com limites de builds.', docs: 'https://developers.cloudflare.com/pages/' },
  google_calendar: { what: 'Sincronizar compromissos com o Google Agenda (OAuth).', how: 'Crie credenciais OAuth no Google Cloud, configure GOOGLE_CLIENT_ID/SECRET como segredos da Edge Function "google-sync" e clique em Conectar.', cost: 'API gratuita dentro das cotas.', docs: 'https://developers.google.com/workspace/calendar/api/guides/overview', action: 'google' },
  google_tasks: { what: 'Sincronizar tarefas compatíveis com o Google Tasks.', how: 'Mesmo OAuth do Google Agenda (escopo tasks). Tarefas do Google não têm horário: horários ficam na agenda interna.', cost: 'API gratuita dentro das cotas.', docs: 'https://developers.google.com/workspace/tasks', action: 'google' },
  whatsapp_link: { what: 'Mensagens por link oficial wa.me (envio confirmado pelo usuário).', how: 'Ativo. Nenhuma configuração necessária.', cost: 'Gratuito.', docs: 'https://faq.whatsapp.com/5913398998672934' },
  whatsapp_cloud: { what: 'Envio e confirmação de entrega via WhatsApp Business Platform (Cloud API).', how: 'Requer conta Meta Business verificada, número dedicado e modelos aprovados. Configure o token como segredo de Edge Function.', cost: 'Cobrança por conversa/mensagem conforme tabela da Meta. NÃO habilitado.', docs: 'https://developers.facebook.com/docs/whatsapp/cloud-api' },
  viacep: { what: 'Preenchimento de endereço pelo CEP.', how: 'Ativo no cadastro de clientes (consulta direta do navegador).', cost: 'Gratuito.', docs: 'https://viacep.com.br' },
  cnpja: { what: 'Consulta de CNPJ em tempo real: Receita Federal, Simples Nacional/MEI e inscrição estadual. Usada no cadastro de clientes e nos dados da empresa.', how: 'Sem chave, usa a API aberta da CNPJá (gratuita, poucas consultas por minuto). Para a API comercial, cadastre o segredo CNPJA_API_KEY nas Edge Functions do Supabase. Validade do cache em Configurações → Parâmetros → Consulta CNPJ.', cost: 'API comercial consome créditos: 1 por consulta online (+1 Simples, +1 inscrição estadual); respostas do cache não custam.', docs: 'https://cnpja.com/api' },
  brasilapi_cnpj: { what: 'Consulta de dados públicos de CNPJ (base da Receita Federal redistribuída).', how: 'Ativo no cadastro (botão Consultar). Fonte e data ficam registradas.', cost: 'Gratuito, sem garantia de disponibilidade.', docs: 'https://brasilapi.com.br/docs' },
  serpro: { what: 'Consulta oficial de CPF/CNPJ (Serpro).', how: 'Requer contratação e credenciais. Até lá, use a conferência manual registrada.', cost: 'Pago por consulta. NÃO contratado.', docs: 'https://www.serpro.gov.br' },
  banco: { what: 'Emissão/baixa de boletos, CNAB e extratos.', how: 'Depende da API e do layout da instituição. Hoje: cadastro manual de boletos e importação OFX.', cost: 'Conforme o banco.', docs: 'https://www.bcb.gov.br' },
  pix_api: { what: 'Cobranças Pix dinâmicas e confirmação automática (API Pix do PSP).', how: 'Requer certificado e credenciais do banco. Hoje: QR estático + conferência manual.', cost: 'Conforme o banco.', docs: 'https://www.bcb.gov.br/estabilidadefinanceira/pix' },
  meta: { what: 'Métricas de Instagram profissional e Facebook (Graph API).', how: 'Requer app Meta com permissões aprovadas. Hoje: lançamento manual de métricas.', cost: 'Gratuito com revisão de app.', docs: 'https://developers.facebook.com/docs/instagram-platform' },
  gemini: { what: 'Interpretação em linguagem natural no assistente (opcional).', how: 'Defina GEMINI_API_KEY como segredo da Edge Function "ai-assistant" e habilite "Assistente com provedor externo" em Configurações. Verifique os termos de uso de dados do plano escolhido.', cost: 'Possui camada gratuita com limites e termos próprios.', docs: 'https://ai.google.dev/gemini-api/docs' }
};

export function IntegrationsPage() {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const q = useList<Row>('integrations', { order: [{ column: 'name' }] });
  const sync = useList<Row>('external_sync_records', { filters: [{ column: 'status', op: 'eq', value: 'erro' }], range: [0, 49] });

  const google = async (op: 'connect' | 'disconnect' | 'sync') => {
    try {
      const r = await db().invoke<{ url?: string; message?: string }>('google-sync', { op, redirect: `${location.origin}/admin/integracoes` });
      if (r.url) location.href = r.url;
      else toast(r.message ?? 'Operação concluída.');
      invalidate();
    } catch (e) {
      toast(`${friendlyError(e)} — verifique se a Edge Function "google-sync" está publicada e configurada.`, 'warning');
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Integrações" subtitle="Adaptadores substituíveis. Se uma integração falhar, o sistema interno continua funcionando com alternativa manual." />
      <div className="mb-4"><Alert tone="warning" title="Política de custo zero">Nenhum serviço pago é contratado ou habilitado automaticamente. Credenciais ficam apenas como segredos no servidor (nunca no navegador).</Alert></div>
      {(sync.data?.rows ?? []).length > 0 && <div className="mb-4"><Alert tone="danger" title="Falhas de sincronização">{sync.data!.rows.length} registro(s) com erro. Use “Reprocessar” na integração correspondente.</Alert></div>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(q.data?.rows ?? []).map((i) => {
          const info = INFO[String(i.provider)];
          const [label, tone] = STATUS[String(i.status)] ?? ['—', 'neutral'];
          return (
            <Card key={String(i.provider)} opaque>
              <div className="flex items-start justify-between gap-2"><p className="flex items-center gap-2 font-display font-bold"><Plug className="size-4 text-tangerine-800" />{String(i.name)}</p><Badge tone={tone}>{label}</Badge></div>
              {info && <div className="mt-2 space-y-1.5 text-sm"><p>{info.what}</p><p className="text-cocoa-700"><strong>Como configurar:</strong> {info.how}</p><p className="text-cocoa-700"><strong>Custo:</strong> {info.cost}</p></div>}
              {i.last_sync_at ? <p className="mt-2 text-xs text-cocoa-700">Última sincronização: {formatDateTimeBR(i.last_sync_at as string)}</p> : null}
              {i.last_error ? <p className="mt-1 text-xs text-danger-700">{String(i.last_error)}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {info && <a href={info.docs} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" icon={<ExternalLink className="size-4" />}>Documentação</Button></a>}
                {info?.action === 'google' && (i.status === 'conectada' ? <>
                  <Button size="sm" variant="soft" icon={<RefreshCw className="size-4" />} onClick={() => google('sync')}>Sincronizar / reprocessar</Button>
                  <Button size="sm" variant="ghost" icon={<Unplug className="size-4" />} onClick={() => google('disconnect')}>Desconectar</Button>
                </> : <Button size="sm" onClick={() => google('connect')}>Conectar conta Google</Button>)}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
