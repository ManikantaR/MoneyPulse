import type { Institution, CsvFormatConfig } from '@moneypulse/shared';
import type { BankParser } from './base.parser';
import { BoaParser } from './boa.parser';
import { BoaCcParser } from './boa-cc.parser';
import { ChaseCcParser } from './chase-cc.parser';
import { ChaseCheckingParser } from './chase-checking.parser';
import { AmexParser } from './amex.parser';
import { CitiParser } from './citi.parser';
import { GenericCsvParser } from './generic-csv.parser';

const BANK_PARSERS: BankParser[] = [
  new BoaParser(),
  new BoaCcParser(),
  new ChaseCcParser(),
  new ChaseCheckingParser(),
  new AmexParser(),
  new CitiParser(),
];

/**
 * Select the best parser for the given CSV headers and account institution.
 *
 * Priority:
 * 1. If institution is known (not 'other'), try that bank's parser first.
 * 2. Auto-detect by scanning all parsers' canParse().
 * 3. Fall back to GenericCsvParser if account has csvFormatConfig.
 * 4. Throw if no parser matches.
 */
export function selectParser(
  headers: string[],
  institution: Institution,
  csvFormatConfig?: CsvFormatConfig | null,
): BankParser | GenericCsvParser {
  // Try institution-specific parser first
  if (institution !== 'other') {
    const match = BANK_PARSERS.find(
      (p) => p.institution === institution && p.canParse(headers),
    );
    if (match) return match;
  }

  // Auto-detect from headers
  const detected = BANK_PARSERS.find((p) => p.canParse(headers));
  if (detected) return detected;

  // Fall back to generic parser
  if (csvFormatConfig) {
    return new GenericCsvParser(csvFormatConfig);
  }

  throw new Error(
    `No parser found for headers: [${headers.join(', ')}]. ` +
      'Set a custom CSV format config on this account for generic parsing.',
  );
}
