import { GenericCsvParser } from '../generic-csv.parser';
import type { CsvFormatConfig } from '@moneypulse/shared';

describe('GenericCsvParser', () => {
  const defaultConfig: CsvFormatConfig = {
    delimiter: ',',
    dateColumn: 'Date',
    dateFormat: 'MM/DD/YYYY',
    descriptionColumn: 'Description',
    amountColumn: 'Amount',
    debitColumn: null,
    creditColumn: null,
    signConvention: 'negative_debit',
    externalIdColumn: null,
    skipRows: 0,
    merchantColumn: null,
    balanceColumn: null,
  };

  it('should parse with negative_debit convention', () => {
    const parser = new GenericCsvParser(defaultConfig);
    const result = parser.parseRows(
      [{ Date: '03/15/2026', Description: 'TEST DEBIT', Amount: '-50.00' }],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(false);
    expect(result.transactions[0].amountCents).toBe(5000);
  });

  it('should parse with positive_debit convention', () => {
    const parser = new GenericCsvParser({
      ...defaultConfig,
      signConvention: 'positive_debit',
    });
    const result = parser.parseRows(
      [{ Date: '03/15/2026', Description: 'TEST CHARGE', Amount: '50.00' }],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(false);
    expect(result.transactions[0].amountCents).toBe(5000);
  });

  it('should parse with split_columns convention', () => {
    const parser = new GenericCsvParser({
      ...defaultConfig,
      amountColumn: null,
      debitColumn: 'Debit',
      creditColumn: 'Credit',
      signConvention: 'split_columns',
    });
    const result = parser.parseRows(
      [
        { Date: '03/15/2026', Description: 'DEBIT', Debit: '25.00', Credit: '' },
        { Date: '03/14/2026', Description: 'CREDIT', Debit: '', Credit: '100.00' },
      ],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(false);
    expect(result.transactions[0].amountCents).toBe(2500);
    expect(result.transactions[1].isCredit).toBe(true);
    expect(result.transactions[1].amountCents).toBe(10000);
  });

  it('should support YYYY-MM-DD date format', () => {
    const parser = new GenericCsvParser({
      ...defaultConfig,
      dateFormat: 'YYYY-MM-DD',
    });
    const result = parser.parseRows(
      [{ Date: '2026-03-15', Description: 'TEST', Amount: '-10.00' }],
      2,
    );
    expect(result.transactions[0].date).toBe('2026-03-15');
  });

  it('should error on invalid date format', () => {
    const parser = new GenericCsvParser(defaultConfig);
    const result = parser.parseRows(
      [{ Date: 'not-a-date', Description: 'TEST', Amount: '-10.00' }],
      2,
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
});
