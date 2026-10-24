import * as ExcelJS from 'exceljs';
import { parseExcelToRows } from '../excel.parser';

/** Build an in-memory .xlsx buffer from an array of row arrays. */
async function buildWorkbookBuffer(
  rows: (string | number)[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  for (const row of rows) {
    worksheet.addRow(row);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe('parseExcelToRows', () => {
  it('detects the header row below an Amex-style preamble', async () => {
    const buffer = await buildWorkbookBuffer([
      ['Statement Period: 01/01/2026 - 01/31/2026'],
      ['Prepared for: Fictional Cardholder'],
      ['Account Number: XXXX-XXXXXX-01234'],
      ['Card Type: Fictional Rewards Card'],
      [],
      [],
      ['Date', 'Description', 'Card Member', 'Account #', 'Amount'],
      ['01/05/2026', 'EXAMPLE MERCHANT A', 'FICTIONAL PERSON', 'XXXXX-01234', '12.34'],
      ['01/07/2026', 'EXAMPLE MERCHANT B', 'FICTIONAL PERSON', 'XXXXX-01234', '56.78'],
    ]);

    const result = await parseExcelToRows(buffer);

    expect(result.headers).toEqual([
      'Date',
      'Description',
      'Card Member',
      'Account #',
      'Amount',
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]['Description']).toBe('EXAMPLE MERCHANT A');
    expect(result.rows[0]['Amount']).toBe('12.34');
    expect(result.rows[1]['Description']).toBe('EXAMPLE MERCHANT B');
  });

  it('leaves a plain sheet with the header at row 1 unchanged', async () => {
    const buffer = await buildWorkbookBuffer([
      ['Date', 'Description', 'Amount'],
      ['02/01/2026', 'EXAMPLE MERCHANT C', '9.99'],
      ['02/02/2026', 'EXAMPLE MERCHANT D', '19.99'],
    ]);

    const result = await parseExcelToRows(buffer);

    expect(result.headers).toEqual(['Date', 'Description', 'Amount']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]['Description']).toBe('EXAMPLE MERCHANT C');
    expect(result.rows[1]['Amount']).toBe('19.99');
  });

  it('falls back to row 1 when no known header signature is found within the scan window', async () => {
    const buffer = await buildWorkbookBuffer([
      ['Foo', 'Bar', 'Baz'],
      ['a', 'b', 'c'],
    ]);

    const result = await parseExcelToRows(buffer);

    expect(result.headers).toEqual(['Foo', 'Bar', 'Baz']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]['Foo']).toBe('a');
  });

  it('returns empty headers/rows for an empty worksheet', async () => {
    const buffer = await buildWorkbookBuffer([]);

    const result = await parseExcelToRows(buffer);

    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([]);
  });
});
