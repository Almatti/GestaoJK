import { Database, FlaskConical } from 'lucide-react';
import { Logo } from '@/components/layout/Logo';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';

/** Exibida quando o Supabase não está configurado. Não simula produção. */
export function SetupPage() {
  const startDemo = () => {
    try {
      localStorage.setItem('jk-demo-enabled', '1');
    } catch {
      /* ignore */
    }
    location.reload();
  };
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-2xl animate-rise">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="surface space-y-5 rounded-[28px] p-7">
          <h1 className="text-2xl font-extrabold">Configuração necessária</h1>
          <p className="text-sm text-cocoa-700">
            O JK CHOPP GESTÃO usa o <strong>Supabase</strong> (PostgreSQL + autenticação) para guardar os dados com segurança. As variáveis de ambiente ainda não foram definidas nesta implantação.
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Crie um projeto em supabase.com e aplique as migrations da pasta <code>supabase/migrations</code> (veja <code>DEPLOYMENT.md</code>).</li>
            <li>Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (chave pública) no Cloudflare Pages ou no arquivo <code>.env.local</code>.</li>
            <li>Publique novamente. O primeiro usuário cadastrado no Supabase Auth torna-se administrador.</li>
          </ol>
          <Alert tone="info" title="Quer apenas conhecer o sistema?">Abra o ambiente de demonstração com dados fictícios, salvos somente neste navegador e totalmente separados da produção.</Alert>
          <div className="flex flex-wrap gap-2">
            <Button icon={<FlaskConical className="size-4" />} onClick={startDemo}>Abrir demonstração</Button>
            <a href="https://supabase.com/docs" target="_blank" rel="noreferrer"><Button variant="secondary" icon={<Database className="size-4" />}>Documentação do Supabase</Button></a>
          </div>
        </div>
      </div>
    </div>
  );
}
