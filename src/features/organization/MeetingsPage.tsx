import { ResourcePage } from '@/features/resource/ResourcePage';
import { meetingsDef } from '@/features/resource/definitions';
export function MeetingsPage() {
  return <ResourcePage def={meetingsDef} />;
}
