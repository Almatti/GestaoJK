/** Patrimônio: status, custódia e conflitos de reserva. Rastreio por movimentações registradas (sem GPS). */
export const EQUIPMENT_STATUS = {
  disponivel: 'Disponível',
  reservado: 'Reservado',
  em_transporte: 'Em transporte',
  instalado: 'Instalado',
  em_ponto_fixo: 'Em ponto fixo',
  em_evento: 'Em evento',
  aguardando_recolhimento: 'Aguardando recolhimento',
  em_manutencao: 'Em manutenção',
  em_higienizacao: 'Em higienização',
  danificado: 'Danificado',
  extraviado: 'Extraviado',
  inativo: 'Inativo'
} as const;
export type EquipmentStatus = keyof typeof EQUIPMENT_STATUS;

export const EXTERNAL_STATUSES: EquipmentStatus[] = ['instalado', 'em_ponto_fixo', 'em_evento', 'aguardando_recolhimento', 'em_transporte'];

export interface Interval {
  start: string; // ISO date/time
  end: string | null; // null = indeterminado
}

export function overlaps(a: Interval, b: Interval): boolean {
  const aEnd = a.end ?? '9999-12-31T23:59:59';
  const bEnd = b.end ?? '9999-12-31T23:59:59';
  return a.start < bEnd && b.start < aEnd;
}

export interface Reservation extends Interval {
  id: string;
  equipmentId: string;
  customerId: string;
  status: 'ativa' | 'cancelada' | 'concluida';
}

export function findReservationConflict(existing: Reservation[], candidate: Omit<Reservation, 'id' | 'status'>): Reservation | null {
  return (
    existing.find((r) => r.status === 'ativa' && r.equipmentId === candidate.equipmentId && overlaps(r, candidate)) ?? null
  );
}

export function isIdle(status: EquipmentStatus, lastMovementDate: string | null, today: string, idleDays: number): boolean {
  if (status !== 'disponivel' || !lastMovementDate) return status === 'disponivel' && !lastMovementDate;
  return (Date.parse(today) - Date.parse(lastMovementDate.slice(0, 10))) / 86_400_000 >= idleDays;
}

export function maintenanceDue(nextDate: string | null, today: string, warnDays = 7): 'atrasada' | 'proxima' | 'ok' | 'sem_agenda' {
  if (!nextDate) return 'sem_agenda';
  if (nextDate < today) return 'atrasada';
  const diff = (Date.parse(nextDate) - Date.parse(today)) / 86_400_000;
  return diff <= warnDays ? 'proxima' : 'ok';
}
