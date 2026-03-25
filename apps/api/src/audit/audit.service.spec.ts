import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { DATABASE_CONNECTION } from '../db/db.module';

describe('AuditService', () => {
  let service: AuditService;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('should insert an audit log entry', async () => {
    await service.log({
      userId: 'user-1',
      action: 'login',
      entityType: 'user',
      entityId: 'user-1',
      ipAddress: '127.0.0.1',
    });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'login',
        entityType: 'user',
      }),
    );
  });

  it('should handle null optional fields', async () => {
    await service.log({
      userId: null,
      action: 'login_failed',
      entityType: 'auth',
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        entityId: null,
        oldValue: null,
        newValue: null,
        ipAddress: null,
      }),
    );
  });
});
