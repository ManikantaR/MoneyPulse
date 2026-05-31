import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let mockNotificationsService: any;

  const TEST_USER: any = { sub: 'user-abc', email: 'test@example.com' };
  const CREATED_ROW = { id: 'notif-xyz', type: 'test', title: 'MoneyPulse test' };

  beforeEach(() => {
    mockNotificationsService = {
      createAndDispatch: vi.fn().mockResolvedValue(CREATED_ROW),
      findByUser: vi.fn().mockResolvedValue([]),
      unreadCount: vi.fn().mockResolvedValue(0),
      markRead: vi.fn().mockResolvedValue(undefined),
      markAllRead: vi.fn().mockResolvedValue(undefined),
    };

    controller = new NotificationsController(mockNotificationsService);
  });

  describe('POST /notifications/test', () => {
    it('calls createAndDispatch with the authenticated user id', async () => {
      await controller.sendTest(TEST_USER);

      expect(mockNotificationsService.createAndDispatch).toHaveBeenCalledTimes(1);
      const call = mockNotificationsService.createAndDispatch.mock.calls[0][0];
      expect(call.userId).toBe(TEST_USER.sub);
    });

    it('calls createAndDispatch with type=test', async () => {
      await controller.sendTest(TEST_USER);

      const call = mockNotificationsService.createAndDispatch.mock.calls[0][0];
      expect(call.type).toBe('test');
      expect(call.title).toBe('MoneyPulse test');
      expect(typeof call.message).toBe('string');
      expect(call.message.length).toBeGreaterThan(0);
    });

    it('returns { data: { id } } matching the created notification', async () => {
      const result = await controller.sendTest(TEST_USER);

      expect(result).toEqual({ data: { id: CREATED_ROW.id } });
    });

    it('does NOT use a passed-in userId — always derives it from @CurrentUser()', async () => {
      // The endpoint takes no body; userId must come only from the JWT payload
      const otherUser: any = { sub: 'user-other' };
      await controller.sendTest(otherUser);

      const call = mockNotificationsService.createAndDispatch.mock.calls[0][0];
      expect(call.userId).toBe('user-other');
      expect(call.userId).not.toBe(TEST_USER.sub);
    });
  });
});
