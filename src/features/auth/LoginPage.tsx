import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getDataClient } from '@/data/client';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Form';
import { Alert, friendlyError } from '@/components/ui/Feedback';
import { Logo } from '@/components/layout/Logo';

const schema = z.object({ email: z.string().trim().email('Informe um e-mail válido'), password: z.string().min(1, 'Informe a senha') });

export function LoginPage() {
  const client = getDataClient();
  const demo = client.mode === 'demo';
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState(false);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: demo ? 'demo@jkchopp.invalid' : '', password: demo ? 'demo' : '' } });

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      await client.auth.signIn(email, password);
    } catch (e) {
      setError(friendlyError(e));
    }
  });

  const onReset = async () => {
    const email = form.getValues('email');
    if (!z.string().email().safeParse(email).success) return setError('Informe seu e-mail para recuperar a senha.');
    try {
      await client.auth.resetPassword(email);
      setInfo('Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.');
      setResetMode(false);
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[420px] animate-rise">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="surface rounded-[28px] p-7">
          <h1 className="text-2xl font-extrabold">{resetMode ? 'Recuperar senha' : 'Entrar'}</h1>
          <p className="mt-1 text-sm text-cocoa-700">Acesso restrito a colaboradores da JK CHOPP. Novos usuários entram por convite do administrador.</p>
          {demo && <div className="mt-4"><Alert tone="warning" title="Ambiente de demonstração">Dados fictícios salvos apenas neste navegador. Qualquer e-mail/senha entra como administrador de demonstração.</Alert></div>}
          {error && <div className="mt-4"><Alert tone="danger">{error}</Alert></div>}
          {info && <div className="mt-4"><Alert tone="success">{info}</Alert></div>}
          <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
            <TextInput label="E-mail" type="email" autoComplete="email" required error={form.formState.errors.email?.message} {...form.register('email')} />
            {!resetMode && <TextInput label="Senha" type="password" autoComplete="current-password" required error={form.formState.errors.password?.message} {...form.register('password')} />}
            {resetMode ? (
              <Button className="w-full justify-center" onClick={onReset}>Enviar link de redefinição</Button>
            ) : (
              <Button type="submit" className="w-full justify-center" size="lg" loading={form.formState.isSubmitting}>Entrar</Button>
            )}
          </form>
          {!demo && (
            <button className="mt-4 w-full text-center text-sm font-medium text-tangerine-900 hover:underline" onClick={() => { setResetMode((m) => !m); setError(null); }}>
              {resetMode ? 'Voltar ao login' : 'Esqueci minha senha'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
