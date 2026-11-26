import { Clock } from 'lucide-react';
import { useAuth } from './AuthContext';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';

export function PendingPage() {
  const { signOut, user } = useAuth();
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="surface max-w-lg rounded-[28px] p-6">
        <EmptyState icon={<Clock className="size-7" />} title="Acesso aguardando aprovação"
          description={`O usuário ${user?.email ?? ''} ainda não foi ativado. Peça a um administrador para liberar seu acesso e definir seu perfil.`}
          action={<Button variant="secondary" onClick={() => signOut()}>Sair</Button>} />
      </div>
    </div>
  );
}
