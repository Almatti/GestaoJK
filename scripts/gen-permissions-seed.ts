// Gera supabase/seed/role_permissions.sql a partir da matriz única em src/domain/permissions.ts.
// Uso: npx tsx scripts/gen-permissions-seed.ts  (ou: node --experimental-strip-types)
import { writeFileSync } from 'node:fs';
import { permissionRows } from '../src/domain/permissions.ts';

const rows = permissionRows().map(([r, res, a]) => `('${r}','${res}','${a}')`);
const sql = `-- GERADO AUTOMATICAMENTE por scripts/gen-permissions-seed.ts — não edite manualmente.
delete from public.role_permissions;
insert into public.role_permissions (role, resource, action) values
${rows.join(',\n')};
`;
writeFileSync(new URL('../supabase/migrations/20261126000900_seed_permissions.sql', import.meta.url), sql);
console.log(`20261126000900_seed_permissions.sql: ${rows.length} linhas`);
