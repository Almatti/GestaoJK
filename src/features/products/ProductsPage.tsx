import { useState } from 'react';
import { Tabs } from '@/components/ui/Layout';
import { ResourcePage } from '@/features/resource/ResourcePage';
import { brandsDef, categoriesDef, kegSizesDef, productsDef } from '@/features/resource/definitions';
import type { ResourceDef } from '@/features/resource/types';

const variantsDef: ResourceDef = {
  table: 'product_variants', title: 'Preços por tamanho de barril', singular: 'Preço por tamanho', resource: 'produtos', searchColumns: [], allowDelete: true,
  subtitle: 'Opcional: preço/custo do barril inteiro por produto e tamanho. Sem cadastro, usa preço por litro × litragem.',
  select: '*,product:products(name),keg_size:keg_sizes(label)', defaultOrder: [{ column: 'product_id' }],
  fields: [
    { name: 'product_id', label: 'Produto', type: 'ref', ref: { table: 'products', label: 'name' }, required: true },
    { name: 'keg_size_id', label: 'Tamanho', type: 'ref', ref: { table: 'keg_sizes', label: 'label' }, required: true },
    { name: 'price', label: 'Preço do barril (R$)', type: 'money', min: 0 },
    { name: 'cost', label: 'Custo do barril (R$)', type: 'money', min: 0 },
    { name: 'active', label: 'Ativo', type: 'boolean', defaultValue: true }
  ],
  columns: [{ key: 'product.name', label: 'Produto', sortable: false }, { key: 'keg_size.label', label: 'Tamanho', sortable: false }, { key: 'price', label: 'Preço', format: 'money', align: 'right' }, { key: 'cost', label: 'Custo', format: 'money', align: 'right' }, { key: 'active', label: 'Ativo', format: 'boolean' }]
};

type T = 'produtos' | 'variantes' | 'tamanhos' | 'categorias' | 'marcas';
export function ProductsPage() {
  const [tab, setTab] = useState<T>('produtos');
  const map: Record<T, ResourceDef> = { produtos: productsDef, variantes: variantsDef, tamanhos: kegSizesDef, categorias: categoriesDef, marcas: brandsDef };
  return (
    <div>
      <Tabs tabs={[{ key: 'produtos', label: 'Produtos' }, { key: 'variantes', label: 'Preços por barril' }, { key: 'tamanhos', label: 'Tamanhos de barril' }, { key: 'categorias', label: 'Categorias' }, { key: 'marcas', label: 'Marcas' }]} value={tab} onChange={setTab} />
      <ResourcePage key={tab} def={map[tab]} />
    </div>
  );
}
