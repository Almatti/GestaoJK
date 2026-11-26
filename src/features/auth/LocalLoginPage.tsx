import { useState } from 'react';
import { HardDrive, LogIn } from 'lucide-react';
import { getDataClient } from '@/data/client';
import { table } from '@/data/demo/store';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Form';
import { Alert, friendlyError } from '@/components/ui/Feedback';
import { Logo } from '@/components/layout/Logo';

/** Entrada do MODO LOCAL: sem servidor. PIN opcional protege o acesso neste dispositivo. */
export function LocalLoginPage() {
  const profile = table('profiles').find((p) => p.id === 'local-user');
  const hasPin = Boolean(table('meta')[0]?.pin_hash);
  const [name, setName] = useState(String(profile?.full_name ?? ''));
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Informe seu nome.');
    setBusy(true);
    try {
      if (profile && name.trim() !== profile.full_name) profile.full_name = name.trim();
      await getDataClient().auth.signIn(name.trim(), pin);
    } catch (err) {
      setError(friendlyError(err));
    }
    setBusy(false);
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[420px] animate-rise">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <form onSubmit={submit} className="surface space-y-4 rounded-[28px] p-7" noValidate>
          <div>
            <h1 className="text-2xl font-extrabold">Entrar</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-cocoa-700"><HardDrive className="size-4" aria-hidden /> Modo local — dados guardados neste dispositivo.</p>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <TextInput label="Seu nome" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
          {hasPin && <TextInput label="PIN de acesso" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} required />}
          <Button type="submit" size="lg" className="w-full justify-center" loading={busy} icon={<LogIn className="size-4" />}>Entrar</Button>
          {!hasPin && <p className="text-xs text-cocoa-700">Dica: defina um PIN em Administração → Backups para proteger o acesso neste aparelho.</p>}
        </form>
      </div>
    </div>
  );
}
