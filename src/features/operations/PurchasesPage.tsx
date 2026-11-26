import { useState } from 'react';
import { Tabs } from '@/components/ui/Layout';
import { ResourcePage } from '@/features/resource/ResourcePage';
import { purchasesDef, suppliersDef } from '@/features/resource/definitions';

export function PurchasesPage() {
  const [tab, setTab] = useState<'compras' | 'fornecedores'>('compras');
  return (
    <div>
      <Tabs tabs={[{ key: 'compras', label: 'Solicitações e pedidos de compra' }, { key: 'fornecedores', label: 'Fornecedores' }]} value={tab} onChange={setTab} />
      {tab === 'compras' ? <ResourcePage def={purchasesDef} /> : <ResourcePage def={suppliersDef} />}
    </div>
  );
}
