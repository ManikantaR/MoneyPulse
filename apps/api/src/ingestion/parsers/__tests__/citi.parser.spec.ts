import { CitiParser } from '../citi.parser';

describe('CitiParser', () => {
  const parser = new CitiParser();

  it('should identify Citi headers', () => {
    expect(
      parser.canParse([
        'Status',
        'Date',
        'Description',
        'Debit',
        'Credit',
      ]),
    ).toBe(true);
  });

  it('should NOT match Chase checking headers (no Status)', () => {
    expect(
      parser.canParse([
        'Transaction Date',
        'Posting Date',
        'Description',
        'Debit',
        'Credit',
        'Balance',
      ]),
    ).toBe(false);
  });

  it('should parse debit row', () => {
    const result = parser.parseRows(
      [
        {
          Status: 'Cleared',
          Date: '03/15/2026',
          Description: 'TARGET STORE',
          Debit: '89.50',
          Credit: '',
        },
      ],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(false);
    expect(result.transactions[0].amountCents).toBe(8950);
  });

  it('should parse credit row', () => {
    const result = parser.parseRows(
      [
        {
          Status: 'Cleared',
          Date: '03/12/2026',
          Description: 'PAYMENT RECEIVED',
          Debit: '',
          Credit: '500.00',
        },
      ],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(true);
    expect(result.transactions[0].amountCents).toBe(50000);
  });
});
