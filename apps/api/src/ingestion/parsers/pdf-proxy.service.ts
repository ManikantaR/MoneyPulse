import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ParsedTransaction, FileUploadError } from '@moneypulse/shared';

/**
 * Response shape from the Python PDF parser microservice.
 * All field names use snake_case to match the Python API.
 */
interface PdfParseResponse {
  transactions: Array<{
    external_id: string | null;
    date: string;
    description: string;
    amount_cents: number;
    is_credit: boolean;
    merchant_name: string | null;
    running_balance_cents: number | null;
  }>;
  errors: Array<{
    page: number;
    error: string;
    raw: string;
  }>;
  detected_bank: string | null;
  pages_processed: number;
  method: string;
}

@Injectable()
export class PdfProxyService {
  private readonly logger = new Logger(PdfProxyService.name);
  private readonly pdfServiceUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.pdfServiceUrl =
      this.config.get<string>('PDF_PARSER_URL') || 'http://localhost:5000';
    this.timeoutMs = parseInt(
      this.config.get<string>('PDF_PARSER_TIMEOUT_MS') || '30000',
      10,
    );
  }

  /**
   * Send a PDF buffer to the Python parser microservice and convert
   * the snake_case response to our standard camelCase ParsedTransaction format.
   *
   * @param buffer - Raw PDF file bytes
   * @param filename - Original filename for the multipart upload
   * @param institution - Optional institution hint (e.g., 'boa') for parser selection
   * @returns Parsed transactions and any errors from the PDF service
   * @throws Never — all errors are caught and returned as FileUploadError entries
   */
  async parsePdf(
    buffer: Buffer,
    filename: string,
    institution?: string,
  ): Promise<{ transactions: ParsedTransaction[]; errors: FileUploadError[] }> {
    try {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([new Uint8Array(buffer)]),
        filename,
      );
      if (institution) {
        formData.append('institution', institution);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      let response: Response;
      try {
        response = await fetch(`${this.pdfServiceUrl}/parse`, {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `PDF parser returned ${response.status}: ${errorText}`,
        );
      }

      const data = (await response.json()) as PdfParseResponse;

      // Convert snake_case Python response to camelCase TypeScript
      const transactions: ParsedTransaction[] = data.transactions.map((t) => ({
        externalId: t.external_id,
        date: t.date,
        description: t.description,
        amountCents: t.amount_cents,
        isCredit: t.is_credit,
        merchantName: t.merchant_name,
        runningBalanceCents: t.running_balance_cents,
      }));

      const errors: FileUploadError[] = data.errors.map((e) => ({
        row: e.page,
        error: e.error,
        raw: e.raw,
      }));

      this.logger.log(
        `PDF parsed: ${transactions.length} transactions, ${errors.length} errors, method: ${data.method}`,
      );

      return { transactions, errors };
    } catch (err: any) {
      this.logger.error(`PDF proxy error: ${err.message}`);
      return {
        transactions: [],
        errors: [
          {
            row: 0,
            error: `PDF parser service error: ${err.message}`,
            raw: '',
          },
        ],
      };
    }
  }

  /**
   * Check if the Python PDF parser service is healthy and reachable.
   *
   * @returns true if the service responds with HTTP 200, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.pdfServiceUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
