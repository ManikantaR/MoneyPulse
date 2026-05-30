import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttachmentService } from '../attachment.service';
import { DATABASE_CONNECTION } from '../../db/db.module';

// Mock filesystem operations
vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
}));

import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs';

describe('AttachmentService', () => {
  let service: AttachmentService;
  let mockDb: any;

  const userId = 'user-1';
  const transactionId = 'txn-1';
  const attachmentId = 'att-1';

  const baseAttachment = {
    id: attachmentId,
    transactionId,
    userId,
    filename: 'uuid.png',
    originalFilename: 'receipt.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    storagePath: '/config/attachments/user-1/txn-1/uuid.png',
    createdAt: new Date('2024-01-01T00:00:00Z'),
  };

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'receipt.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('fake image data'),
    destination: '',
    filename: '',
    path: '',
    stream: null as any,
  };

  function makeDb(overrides: Partial<any> = {}) {
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockResolvedValue([]),
      ...overrides,
    };
    return chain;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb = makeDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttachmentService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn().mockReturnValue('/config/attachments'),
          },
        },
      ],
    }).compile();

    service = module.get<AttachmentService>(AttachmentService);
  });

  // ── verifyTransactionOwnership ────────────────────────────

  describe('verifyTransactionOwnership', () => {
    it('resolves when transaction belongs to user and is not deleted', async () => {
      mockDb.limit.mockResolvedValue([{ id: transactionId }]);
      await expect(
        service.verifyTransactionOwnership(transactionId, userId),
      ).resolves.toBeUndefined();
    });

    it('throws NotFoundException when transaction is not found', async () => {
      mockDb.limit.mockResolvedValue([]);
      await expect(
        service.verifyTransactionOwnership(transactionId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when transaction belongs to another user', async () => {
      mockDb.limit.mockResolvedValue([]); // query filters by userId, so empty = not found/wrong user
      await expect(
        service.verifyTransactionOwnership(transactionId, 'other-user'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── createAttachment ──────────────────────────────────────

  describe('createAttachment', () => {
    it('writes file to disk and inserts DB record for a valid PNG upload', async () => {
      mockDb.returning.mockResolvedValue([baseAttachment]);

      const result = await service.createAttachment(
        transactionId,
        userId,
        mockFile,
      );

      expect(mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('user-1/txn-1'),
        { recursive: true },
      );
      expect(writeFileSync).toHaveBeenCalled();
      expect(result.originalFilename).toBe('receipt.png');
      expect(result.mimeType).toBe('image/png');
      expect(result.userId).toBe(userId);
    });

    it('writes file to disk and inserts DB record for a valid PDF upload', async () => {
      const pdfFile: Express.Multer.File = {
        ...mockFile,
        originalname: 'bill.pdf',
        mimetype: 'application/pdf',
      };
      const pdfAttachment = { ...baseAttachment, originalFilename: 'bill.pdf', mimeType: 'application/pdf' };
      mockDb.returning.mockResolvedValue([pdfAttachment]);

      const result = await service.createAttachment(transactionId, userId, pdfFile);

      expect(writeFileSync).toHaveBeenCalled();
      expect(result.mimeType).toBe('application/pdf');
    });

    it('rolls back file from disk when DB insert fails', async () => {
      mockDb.returning.mockRejectedValue(new Error('DB error'));

      await expect(
        service.createAttachment(transactionId, userId, mockFile),
      ).rejects.toThrow(InternalServerErrorException);

      expect(unlinkSync).toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when mkdirSync fails', async () => {
      vi.mocked(mkdirSync).mockImplementationOnce(() => {
        throw new Error('EACCES: permission denied');
      });

      await expect(
        service.createAttachment(transactionId, userId, mockFile),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ── listAttachments ───────────────────────────────────────

  describe('listAttachments', () => {
    it('returns attachments for a transaction owned by the user', async () => {
      // Ownership check ends with .limit(), list query ends with .where()
      // First .where() call → must stay chainable so .limit() can follow
      // Second .where() call → must resolve directly with the attachment array
      mockDb.where
        .mockReturnValueOnce(mockDb) // ownership check: .where().limit()
        .mockResolvedValueOnce([baseAttachment]); // list query: awaited directly
      mockDb.limit.mockResolvedValueOnce([{ id: transactionId }]);

      const results = await service.listAttachments(transactionId, userId);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(attachmentId);
    });

    it('throws NotFoundException when transaction does not belong to user', async () => {
      mockDb.limit.mockResolvedValue([]); // ownership check fails
      await expect(
        service.listAttachments(transactionId, 'other-user'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── deleteAttachment ──────────────────────────────────────

  describe('deleteAttachment', () => {
    it('removes file from disk and deletes DB record', async () => {
      mockDb.limit.mockResolvedValue([baseAttachment]);
      vi.mocked(existsSync).mockReturnValue(true);

      await service.deleteAttachment(attachmentId, userId);

      expect(unlinkSync).toHaveBeenCalledWith(baseAttachment.storagePath);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('still deletes DB record when file is already absent (ENOENT)', async () => {
      mockDb.limit.mockResolvedValue([baseAttachment]);
      vi.mocked(existsSync).mockReturnValue(false);

      await service.deleteAttachment(attachmentId, userId);

      expect(unlinkSync).not.toHaveBeenCalled(); // file doesn't exist, skip unlink
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('throws NotFoundException when attachment belongs to another user', async () => {
      mockDb.limit.mockResolvedValue([{ ...baseAttachment, userId: 'other-user' }]);

      await expect(
        service.deleteAttachment(attachmentId, userId),
      ).rejects.toThrow(NotFoundException);

      expect(unlinkSync).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when attachment does not exist', async () => {
      mockDb.limit.mockResolvedValue([]);

      await expect(
        service.deleteAttachment(attachmentId, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── findById ─────────────────────────────────────────────

  describe('findById', () => {
    it('returns the attachment when found', async () => {
      mockDb.limit.mockResolvedValue([baseAttachment]);

      const result = await service.findById(attachmentId);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(attachmentId);
    });

    it('returns null when attachment is not found', async () => {
      mockDb.limit.mockResolvedValue([]);

      const result = await service.findById('nonexistent-id');
      expect(result).toBeNull();
    });
  });
});
