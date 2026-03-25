import { BoaParser } from '../boa.parser';

describe('BoaParser', () => {
  const parser = new BoaParser();

  it('should identify BofA headers', () => {
    expect(
      parser.canParse([
        'Date',
        'Reference Number',
        'Description',
        'Amount',
        'Running Bal.',
      ]),
    ).toBe(true);
    expect(parser.canParse(['Date', 'Description', 'Amount'])).toBe(false);
  });

  it('should parse debit transaction (negative amount)', () => {
    const result = parser.parseRows(
      [
        {
          Date: '03/15/2026',
          'Reference Number': '123',
          Description: 'WHOLE FOODS',
          Amount: '-85.23',
          'Running Bal.': '4234.56',
        },
      ],
      2,
    );
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amountCents).toBe(8523);
    expect(result.transactions[0].isCredit).toBe(false);
    expect(result.transactions[0].externalId).toBe('123');
    expect(result.transactions[0].date).toBe('2026-03-15');
    expect(result.transactions[0].runningBalanceCents).toBe(423456);
  });

  it('should parse credit transaction (positive amount)', () => {
    const result = parser.parseRows(
      [
        {
          Date: '03/14/2026',
          'Reference Number': '456',
          Description: 'PAYROLL',
          Amount: '3200.00',
          'Running Bal.': '4319.79',
        },
      ],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(true);
    expect(result.transactions[0].amountCents).toBe(320000);
  });

  it('should handle invalid date', () => {
    const result = parser.parseRows(
      [
        {
          Date: 'invalid',
          'Reference Number': '789',
          Description: 'TEST',
          Amount: '100.00',
          'Running Bal.': '0',
        },
      ],
      2,
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(2);
  });

  it('should handle empty description', () => {
    const result = parser.parseRows(
      [
        {
          Date: '03/15/2026',
          'Reference Number': '111',
          Description: '',
          Amount: '50.00',
          'Running Bal.': '0',
        },
      ],
      2,
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });

  it('should handle comma-formatted amounts', () => {
    const result = parser.parseRows(
      [
        {
          Date: '03/15/2026',
          'Reference Number': '999',
          Description: 'LARGE PURCHASE',
          Amount: '-1,234.56',
          'Running Bal.': '0',
        },
      ],
      2,
    );
    expect(result.transactions[0].amountCents).toBe(123456);
  });
});
