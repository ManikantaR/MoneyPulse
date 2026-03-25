import * as ExcelJS from 'exceljs';

/**
 * Excel Parser — reads .xlsx/.xls file buffer and converts
 * the first sheet to an array of row objects (header-keyed).
 * Uses exceljs (no ReDoS or prototype-pollution vulnerabilities).
 * Then delegates to the appropriate CSV parser.
 */
export async function parseExcelToRows(buffer: Buffer): Promise<{
  headers: string[];
  rows: Record<string, string>[];
}> {
  const workbook = new ExcelJS.Workbook();
  // exceljs declares Buffer as extending ArrayBuffer (conflicting with Node.js),
  // so we cast via any to avoid the spurious TS error at compile time.
  // At runtime, exceljs correctly handles Node.js Buffer objects.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) {
    return { headers: [], rows: [] };
  }

  const headers: string[] = [];
  const rows: Record<string, string>[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      // First row contains column headers
      row.eachCell({ includeEmpty: true }, (cell) => {
        headers.push(cellToString(cell.value));
      });
    } else {
      const rowObj: Record<string, string> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber - 1] ?? `col_${colNumber}`;
        rowObj[header] = cellToString(cell.value);
      });
      // Fill in any missing headers for empty cells not visited by eachCell
      for (const header of headers) {
        if (!(header in rowObj)) {
          rowObj[header] = '';
        }
      }
      rows.push(rowObj);
    }
  });

  return { headers, rows };
}

/**
 * Convert an ExcelJS cell value to a plain string.
 * Handles dates, rich text, numbers, booleans, formulas, and null.
 */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) {
    // Return ISO date portion (YYYY-MM-DD) for date cells
    return value.toISOString().split('T')[0];
  }
  // Rich text object: { richText: [{ text: '...' }] }
  if (typeof value === 'object' && 'richText' in value) {
    return (value as ExcelJS.CellRichTextValue).richText
      .map((r) => r.text)
      .join('');
  }
  // Formula result: { formula: '...', result: ... }
  if (typeof value === 'object' && 'result' in value) {
    return cellToString(
      (value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue,
    );
  }
  // Shared formula: { sharedFormula: '...', result: ... }
  if (typeof value === 'object' && 'sharedFormula' in value) {
    return cellToString(
      (value as ExcelJS.CellSharedFormulaValue).result as ExcelJS.CellValue,
    );
  }
  return String(value);
}
