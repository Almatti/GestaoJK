import { parseOfx, matchTransactions } from './ofx';
const SAMPLE = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261120120000[-3:BRT]<TRNAMT>1025.00<FITID>A1<MEMO>PIX RECEBIDO BAR TESTE
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261121<TRNAMT>-480,00<FITID>A2<NAME>POSTO
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
describe('OFX', () => {
  it('extrai transações SGML', () => {
    const t = parseOfx(SAMPLE);
    expect(t).toEqual([
      { fitId: 'A1', date: '2026-11-20', amount: 1025, memo: 'PIX RECEBIDO BAR TESTE', type: 'CREDIT' },
      { fitId: 'A2', date: '2026-11-21', amount: -480, memo: 'POSTO', type: 'DEBIT' }
    ]);
  });
  it('sugere conciliação por valor e data', () => {
    const r = matchTransactions(parseOfx(SAMPLE), [{ id: 'x', amount: 1025, occurred_on: '2026-11-19' }, { id: 'y', amount: -480, occurred_on: '2026-11-30' }]);
    expect(r[0]!.match?.id).toBe('x');
    expect(r[1]!.match).toBeNull();
  });
});
