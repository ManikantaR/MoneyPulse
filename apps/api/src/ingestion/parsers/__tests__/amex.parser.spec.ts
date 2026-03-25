import { AmexParser } from '../amex.parser';

describe('AmexParser', () => {
  const parser = new AmexParser();

  it('should identify Amex headers (3 columns)', () => {
    expect(parser.canParse(['Date', 'Description', 'Amount'])).toBe(true);
  });

  it('should NOT match BofA headers', () => {
    expect(
      parser.canParse([
        'Date',
        'Reference Number',
        'Description',
        'Amount',
        'Running Bal.',
      ]),
    ).toBe(false);
  });

  it('should NOT match Citi headers', () => {
    expect(
      parser.canParse([
        'Status',
        'Date',
        'Description',
        'Debit',
        'Credit',
      ]),
    ).toBe(false);
  });

  it('should treat positive as debit (OPPOSITE of BofA)', () => {
    const result = parser.parseRows(
      [{ Date: '03/15/2026', Description: 'UBER EATS', Amount: '34.50' }],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(false);
    expect(result.transactions[0].amountCents).toBe(3450);
  });

  it('should treat negative as credit', () => {
    const result = parser.parseRows(
      [{ Date: '03/12/2026', Description: 'AMEX PAYMENT', Amount: '-500.00' }],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(true);
    expect(result.transactions[0].amountCents).toBe(50000);
  });

  it('should handle invalid date', () => {
    const result = parser.parseRows(
      [{ Date: 'bad-date', Description: 'TEST', Amount: '10.00' }],
      2,
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
});
