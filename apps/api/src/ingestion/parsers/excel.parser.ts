import * as XLSX from 'xlsx';

/**
 * Excel Parser — reads .xlsx/.xls file buffer and converts
 * the first sheet to an array of row objects (header-keyed).
 * Then delegates to the appropriate CSV parser.
 */
export function parseExcelToRows(buffer: Buffer): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { headers: [], rows: [] };
  }

  const sheet = workbook.Sheets[sheetName];
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    raw: false, // return strings, not parsed numbers
    defval: '', // empty cells → empty string
  });

  if (jsonRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = Object.keys(jsonRows[0]);
  const rows = jsonRows.map((row) => {
    const stringRow: Record<string, string> = {};
    for (const key of headers) {
      stringRow[key] = String(row[key] ?? '');
    }
    return stringRow;
  });

  return { headers, rows };
}
