import { ChaseCcParser } from '../chase-cc.parser';

describe('ChaseCcParser', () => {
  const parser = new ChaseCcParser();

  it('should identify Chase CC headers', () => {
    expect(
      parser.canParse([
        'Transaction Date',
        'Post Date',
        'Description',
        'Category',
        'Type',
        'Amount',
      ]),
    ).toBe(true);
  });

  it('should NOT match Chase checking headers', () => {
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
    ).toBe(false);
  });

  it('should parse charge (negative = debit)', () => {
    const result = parser.parseRows(
      [
        {
          'Transaction Date': '03/15/2026',
          'Post Date': '03/16/2026',
          Description: 'STARBUCKS',
          Category: 'Food & Drink',
          Type: 'Sale',
          Amount: '-5.75',
        },
      ],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(false);
    expect(result.transactions[0].amountCents).toBe(575);
    expect(result.transactions[0].date).toBe('2026-03-15');
  });

  it('should parse payment (positive = credit)', () => {
    const result = parser.parseRows(
      [
        {
          'Transaction Date': '03/12/2026',
          'Post Date': '03/13/2026',
          Description: 'PAYMENT THANK YOU',
          Category: '',
          Type: 'Payment',
          Amount: '1500.00',
        },
      ],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(true);
    expect(result.transactions[0].amountCents).toBe(150000);
  });
});
