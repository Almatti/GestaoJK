import { useState } from 'react';
import { Tabs } from '@/components/ui/Layout';
import { ResourcePage } from '@/features/resource/ResourcePage';
import { equipmentDef, equipmentTypesDef } from '@/features/resource/definitions';

export function EquipmentPage() {
  const [tab, setTab] = useState<'equip' | 'tipos'>('equip');
  return (
    <div>
      <Tabs tabs={[{ key: 'equip', label: 'Equipamentos' }, { key: 'tipos', label: 'Tipos e periodicidades' }]} value={tab} onChange={setTab} />
      {tab === 'equip' ? <ResourcePage def={equipmentDef} /> : <ResourcePage def={equipmentTypesDef} />}
    </div>
  );
}
