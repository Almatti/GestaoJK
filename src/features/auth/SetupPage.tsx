import { Database, FlaskConical, HardDrive } from 'lucide-react';
import { Logo } from '@/components/layout/Logo';
import { Button } from '@/components/ui/Button';

/** Exibida quando o Supabase não está configurado. Não simula produção. */
export function SetupPage() {
  const startLocal = () => {
    try {
      localStorage.setItem('jk-local-enabled', '1');
      localStorage.removeItem('jk-demo-enabled');
    } catch {
      /* ignore */
    }
    location.reload();
  };
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
          <h1 className="text-2xl font-extrabold">Como você quer usar o JK CHOPP GESTÃO?</h1>
          <div className="rounded-2xl border-2 border-tangerine-700 bg-cream-100 p-5">
            <p className="font-display text-lg font-bold">Usar agora, sem servidor</p>
            <p className="mt-1 text-sm text-cocoa-700">Comece a cadastrar clientes, produtos, pedidos e o financeiro imediatamente. O sistema começa vazio e os dados ficam salvos <strong>neste navegador</strong>. Faça backups em Administração → Backups; depois, os dados podem ser levados ao servidor (Supabase).</p>
            <Button className="mt-3" size="lg" icon={<HardDrive className="size-4" />} onClick={startLocal}>Começar a usar agora</Button>
          </div>
          <div className="rounded-2xl border border-tangerine-200 p-5">
            <p className="font-display font-bold">Apenas conhecer o sistema</p>
            <p className="mt-1 text-sm text-cocoa-700">Demonstração com dados fictícios, separada dos seus dados reais.</p>
            <Button className="mt-3" variant="secondary" icon={<FlaskConical className="size-4" />} onClick={startDemo}>Abrir demonstração</Button>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">Configurar servidor (Supabase) — para depois</summary>
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-cocoa-700">
              <li>Crie um projeto em supabase.com e aplique as migrations da pasta <code>supabase/migrations</code> (veja <code>DEPLOYMENT.md</code>).</li>
              <li>Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (chave pública) na hospedagem.</li>
              <li>Publique novamente e importe o backup do modo local.</li>
            </ol>
            <a className="mt-2 inline-block" href="https://supabase.com/docs" target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" icon={<Database className="size-4" />}>Documentação do Supabase</Button></a>
          </details>
        </div>
      </div>
    </div>
  );
}
