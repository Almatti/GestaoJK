import { ResourcePage } from '@/features/resource/ResourcePage';
import { servicesDef } from '@/features/resource/definitions';
export function ServicesPage() {
  return <ResourcePage def={servicesDef} />;
}
