import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockDb: any;
  let mockWebhookService: any;
  let mockTelegramPush: any;
  let mockWebPush: any;
  let mockPreferences: any;
  let mockOutbox: any;
  let mockAliasMapper: any;

  const TEST_USER = 'user-abc';
  const INSERTED_ROW = {
    id: 'notif-123',
    userId: TEST_USER,
    type: 'spending_anomaly',
    title: 'Unusual spend',
    message: 'You spent $600 at Merchant X',
    webhookSent: false,
    isRead: false,
    metadata: null,
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    const returningMock = vi.fn().mockResolvedValue([INSERTED_ROW]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });

    const updateWhereChain = { where: vi.fn().mockResolvedValue([]) };
    const setMock = vi.fn().mockReturnValue(updateWhereChain);
    const updateMock = vi.fn().mockReturnValue({ set: setMock });

    const deleteWhereMock = vi.fn().mockResolvedValue([]);
    const deleteMock = vi.fn().mockReturnValue({ where: deleteWhereMock });

    mockDb = {
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    };

    mockWebhookService = {
      sendWebhook: vi.fn().mockResolvedValue(false),
    };

    // Disabled by default so createAndDispatch skips the Telegram path (no user-settings read).
    mockTelegramPush = {
      enabled: false,
      sendToUser: vi.fn().mockResolvedValue(false),
    };

    mockWebPush = {
      enabled: false,
      sendToUser: vi.fn().mockResolvedValue(0),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      getVapidPublicKey: vi.fn().mockReturnValue(null),
    };

    // Mock preferences service to return defaults (mode='instant', all channels disabled except inApp)
    mockPreferences = {
      getPreference: vi.fn().mockResolvedValue({
        id: 'pref-123',
        userId: TEST_USER,
        notificationType: 'system_alert',
        mode: 'instant',
        enabledChannels: ['inApp'],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      isInQuietHours: vi.fn().mockResolvedValue(false),
      getQuietHours: vi.fn().mockResolvedValue({ start: '22:00', end: '08:00' }),
    };

    mockOutbox = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    };

    mockAliasMapper = {
      toAliasId: vi.fn().mockReturnValue('a1_deadbeef1234567890'),
    };

    service = new NotificationsService(
      mockDb,
      mockWebhookService,
      mockTelegramPush,
      mockWebPush,
      mockPreferences,
      mockOutbox,
      mockAliasMapper,
    );
  });

  describe('remove', () => {
    it('deletes the notification scoped to the owning user', async () => {
      await service.remove('notif-1', 'user-1');

      expect(mockDb.delete).toHaveBeenCalledTimes(1);
      expect(mockDb.delete().where).toHaveBeenCalledTimes(1);
    });
  });

  describe('createAndDispatch', () => {
    it('inserts the notification row and returns it', async () => {
      const result = await service.createAndDispatch({
        userId: TEST_USER,
        type: 'spending_anomaly',
        title: 'Unusual spend',
        message: 'You spent $600 at Merchant X',
      });

      expect(result).toEqual(INSERTED_ROW);
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it('enqueues a notification.projected.v1 event with body (not message)', async () => {
      await service.createAndDispatch({
        userId: TEST_USER,
        type: 'spending_anomaly',
        title: 'Unusual spend',
        message: 'You spent $600 at Merchant X',
      });

      expect(mockOutbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'notification.projected.v1',
          aggregateType: 'notification',
          aggregateId: INSERTED_ROW.id,
          userId: TEST_USER,
          payload: expect.objectContaining({
            notificationAliasId: 'a1_deadbeef1234567890',
            type: INSERTED_ROW.type,
            title: INSERTED_ROW.title,
            body: INSERTED_ROW.message,
          }),
        }),
      );

      // 'message' must NOT be a top-level payload field (web ignores it; sanitizer would pass it, but we keep contract clean)
      const enqueueCall = mockOutbox.enqueue.mock.calls[0][0];
      expect(enqueueCall.payload).not.toHaveProperty('message');
    });

    it('still returns the inserted row when outbox.enqueue throws', async () => {
      mockOutbox.enqueue.mockRejectedValue(new Error('ALIAS_SECRET not set'));

      const result = await service.createAndDispatch({
        userId: TEST_USER,
        type: 'spending_anomaly',
        title: 'Unusual spend',
        message: 'You spent $600 at Merchant X',
      });

      expect(result).toEqual(INSERTED_ROW);
    });

    it('fires webhook fire-and-forget (does not block return)', async () => {
      // Webhook takes a long time but createAndDispatch should resolve quickly
      let webhookResolve!: (v: boolean) => void;
      mockWebhookService.sendWebhook.mockReturnValue(
        new Promise<boolean>((res) => { webhookResolve = res; }),
      );

      const result = await service.createAndDispatch({
        userId: TEST_USER,
        type: 'large_debit',
        title: 'Large purchase',
        message: '$600 at Merchant',
      });

      // createAndDispatch resolved without waiting for webhook
      expect(result).toEqual(INSERTED_ROW);
      // resolve the webhook now — no crash
      webhookResolve(true);
    });

    it('skips channel delivery when preference mode is off', async () => {
      mockPreferences.getPreference.mockResolvedValue({
        id: 'pref-123',
        userId: TEST_USER,
        notificationType: 'system_alert',
        mode: 'off',
        enabledChannels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.createAndDispatch({
        userId: TEST_USER,
        type: 'spending_anomaly',
        title: 'Unusual spend',
        message: 'You spent $600',
        notificationType: 'system_alert',
      });

      // Give dispatch async a tick to settle
      await new Promise((r) => setTimeout(r, 10));

      // No channel delivery should occur
      expect(mockWebhookService.sendWebhook).not.toHaveBeenCalled();
      expect(mockTelegramPush.sendToUser).not.toHaveBeenCalled();
      expect(mockWebPush.sendToUser).not.toHaveBeenCalled();
    });

    it('calls getPreference to check routing preferences', async () => {
      await service.createAndDispatch({
        userId: TEST_USER,
        type: 'spending_anomaly',
        title: 'Unusual spend',
        message: 'You spent $600',
        notificationType: 'system_alert',
      });

      // Give dispatch async a tick to settle
      await new Promise((r) => setTimeout(r, 10));

      // Should have checked preferences for routing
      expect(mockPreferences.getPreference).toHaveBeenCalledWith(TEST_USER, 'system_alert');
      expect(mockPreferences.isInQuietHours).toHaveBeenCalled();
    });
  });
});

describe('WebhookService.isUrlSafe allowlist', () => {
  // Import and test isUrlSafe in isolation via a helper instance
  let WebhookServiceClass: typeof import('./webhook.service').WebhookService;

  beforeEach(async () => {
    const mod = await import('./webhook.service');
    WebhookServiceClass = mod.WebhookService;
  });

  afterEach(() => {
    delete process.env.HA_WEBHOOK_ALLOWED_HOSTS;
  });

  it('returns true for a host in HA_WEBHOOK_ALLOWED_HOSTS', () => {
    process.env.HA_WEBHOOK_ALLOWED_HOSTS = '192.168.30.10,homeassistant.local';
    const svc = new (WebhookServiceClass as any)(null);
    expect(svc.isUrlSafe('http://192.168.30.10:8123/api/webhook/abc')).toBe(true);
  });

  it('returns true for hostname in allowlist', () => {
    process.env.HA_WEBHOOK_ALLOWED_HOSTS = 'homeassistant.local';
    const svc = new (WebhookServiceClass as any)(null);
    expect(svc.isUrlSafe('http://homeassistant.local:8123/api/webhook/abc')).toBe(true);
  });

  it('returns false for a non-allowlisted 192.168.x.x address', () => {
    process.env.HA_WEBHOOK_ALLOWED_HOSTS = '192.168.30.10';
    const svc = new (WebhookServiceClass as any)(null);
    expect(svc.isUrlSafe('http://192.168.1.99:8123/api/webhook/abc')).toBe(false);
  });

  it('returns false for private IP when no allowlist is set', () => {
    const svc = new (WebhookServiceClass as any)(null);
    expect(svc.isUrlSafe('http://192.168.1.50:8123/api/webhook/abc')).toBe(false);
  });

  it('returns true for a normal public URL', () => {
    const svc = new (WebhookServiceClass as any)(null);
    expect(svc.isUrlSafe('https://example.com/webhook')).toBe(true);
  });
});
