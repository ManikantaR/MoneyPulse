import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PdfProxyService } from '../pdf-proxy.service';

describe('PdfProxyService', () => {
  let service: PdfProxyService;
  let mockConfig: any;

  beforeEach(() => {
    mockConfig = {
      get: vi.fn().mockReturnValue('http://localhost:5000'),
    };
    service = new PdfProxyService(mockConfig);
  });

  describe('parsePdf', () => {
    it('should return parsed transactions from PDF parser service', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          transactions: [
            {
              external_id: null,
              date: '2026-03-15',
              description: 'WHOLE FOODS MARKET',
              amount_cents: 8523,
              is_credit: false,
              merchant_name: 'whole foods market',
              running_balance_cents: null,
            },
          ],
          errors: [],
          detected_bank: 'boa',
          pages_processed: 1,
          method: 'rule_based',
        }),
      };

      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as any);

      const result = await service.parsePdf(
        Buffer.from('fake-pdf'),
        'statement.pdf',
        'boa',
      );

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].description).toBe('WHOLE FOODS MARKET');
      expect(result.transactions[0].amountCents).toBe(8523);
      expect(result.transactions[0].isCredit).toBe(false);
      expect(result.errors).toHaveLength(0);
    });

    it('should convert snake_case response to camelCase', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          transactions: [
            {
              external_id: 'txn-001',
              date: '2026-03-01',
              description: 'PAYROLL',
              amount_cents: 320000,
              is_credit: true,
              merchant_name: 'payroll',
              running_balance_cents: 543210,
            },
          ],
          errors: [],
          detected_bank: null,
          pages_processed: 1,
          method: 'rule_based',
        }),
      };

      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as any);

      const result = await service.parsePdf(Buffer.from('pdf'), 'test.pdf');

      expect(result.transactions[0].externalId).toBe('txn-001');
      expect(result.transactions[0].merchantName).toBe('payroll');
      expect(result.transactions[0].runningBalanceCents).toBe(543210);
    });

    it('should return errors when PDF parser returns errors', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          transactions: [],
          errors: [{ page: 1, error: 'Could not parse page 1', raw: '' }],
          detected_bank: null,
          pages_processed: 1,
          method: 'none',
        }),
      };

      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as any);

      const result = await service.parsePdf(Buffer.from('pdf'), 'bad.pdf');

      expect(result.transactions).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Could not parse');
    });

    it('should handle non-200 response from PDF service', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Internal Server Error'),
      };

      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as any);

      const result = await service.parsePdf(Buffer.from('pdf'), 'test.pdf');

      expect(result.transactions).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('PDF parser returned 500');
    });

    it('should handle fetch failure gracefully', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Connection refused'));

      const result = await service.parsePdf(Buffer.from('pdf'), 'test.pdf');

      expect(result.transactions).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Connection refused');
    });

    it('should pass institution as form data when provided', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          transactions: [],
          errors: [],
          detected_bank: null,
          pages_processed: 0,
          method: 'none',
        }),
      };

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as any);

      await service.parsePdf(Buffer.from('pdf'), 'test.pdf', 'boa');

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:5000/parse',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('healthCheck', () => {
    it('should return true when service is healthy', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as any);
      expect(await service.healthCheck()).toBe(true);
    });

    it('should return false when service is down', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
      expect(await service.healthCheck()).toBe(false);
    });

    it('should return false when service returns non-200', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as any);
      expect(await service.healthCheck()).toBe(false);
    });
  });
});
