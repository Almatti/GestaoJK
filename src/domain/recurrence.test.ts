import { buildRRule, describeRRule, occurrences, parseRRule } from './recurrence';
describe('recorrência de agenda', () => {
  it('reunião toda terça pela manhã', () => {
    const start = '2026-12-01T12:00:00.000Z'; // terça 09:00 em SP
    const occ = occurrences(start, 'FREQ=WEEKLY;BYDAY=TU', new Date('2026-12-01T00:00:00Z'), new Date('2026-12-31T00:00:00Z'));
    expect(occ.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22', '2026-12-29']);
    expect(describeRRule('FREQ=WEEKLY;BYDAY=TU')).toBe('Toda(s) terça');
  });
  it('quinzenal com parceiros', () => {
    const start = '2026-12-03T17:00:00.000Z';
    const rule = buildRRule('quinzenal', start)!;
    expect(rule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=TH');
    const occ = occurrences(start, rule, new Date('2026-12-01T00:00:00Z'), new Date('2027-01-31T00:00:00Z'));
    expect(occ.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-12-03', '2026-12-17', '2026-12-31', '2027-01-14', '2027-01-28']);
  });
  it('COUNT, UNTIL e evento único', () => {
    expect(occurrences('2026-12-01T12:00:00Z', 'FREQ=DAILY;COUNT=3', new Date('2026-11-01'), new Date('2027-01-01'))).toHaveLength(3);
    expect(occurrences('2026-12-01T12:00:00Z', 'FREQ=DAILY;UNTIL=20261205', new Date('2026-11-01'), new Date('2027-01-01'))).toHaveLength(5);
    expect(occurrences('2026-12-01T12:00:00Z', null, new Date('2026-11-01'), new Date('2027-01-01'))).toHaveLength(1);
    expect(parseRRule('FREQ=HOURLY')).toBeNull();
  });
});
