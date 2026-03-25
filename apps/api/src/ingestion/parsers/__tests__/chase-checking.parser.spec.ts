import { ChaseCheckingParser } from '../chase-checking.parser';

describe('ChaseCheckingParser', () => {
  const parser = new ChaseCheckingParser();

  it('should identify Chase checking headers', () => {
    expect(
      parser.canParse([
        'Transaction Date',
        'Posting Date',
        'Description',
        'Category',
        'Debit',
        'Credit',
        'Balance',
      ]),
    ).toBe(true);
  });

  it('should parse debit row', () => {
    const result = parser.parseRows(
      [
        {
          'Transaction Date': '03/15/2026',
          'Posting Date': '03/15/2026',
          Description: 'AMAZON.COM',
          Category: 'Shopping',
          Debit: '45.99',
          Credit: '',
          Balance: '3200.00',
        },
      ],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(false);
    expect(result.transactions[0].amountCents).toBe(4599);
    expect(result.transactions[0].runningBalanceCents).toBe(320000);
  });

  it('should parse credit row', () => {
    const result = parser.parseRows(
      [
        {
          'Transaction Date': '03/14/2026',
          'Posting Date': '03/14/2026',
          Description: 'PAYROLL',
          Category: '',
          Debit: '',
          Credit: '3200.00',
          Balance: '3245.99',
        },
      ],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(true);
    expect(result.transactions[0].amountCents).toBe(320000);
  });

  it('should error on missing debit and credit', () => {
    const result = parser.parseRows(
      [
        {
          'Transaction Date': '03/15/2026',
          'Posting Date': '03/15/2026',
          Description: 'TEST',
          Category: '',
          Debit: '',
          Credit: '',
          Balance: '0',
        },
      ],
      2,
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
});
