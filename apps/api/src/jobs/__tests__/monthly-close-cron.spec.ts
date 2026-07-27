import { AlertCronProcessor } from '../alert-cron.processor';

/** 13.5 decision #8 explicitly calls out that a prior phase's cron job was
 *  registered but never actually invoked its service — this test guards against
 *  that regression by asserting the 'monthly-close-auto-draft' job name really
 *  dispatches to MonthlyCloseService.runAutoDraftForAllUsers, not just that the
 *  scheduler upsert exists. */
describe('AlertCronProcessor — monthly-close-auto-draft', () => {
  it('invokes MonthlyCloseService.runAutoDraftForAllUsers', async () => {
    const monthlyCloseService = {
      runAutoDraftForAllUsers: vi.fn().mockResolvedValue({ usersProcessed: 3, closesCreated: 2 }),
    };
    const noop = {} as any;
    const processor = new AlertCronProcessor(
      noop, noop, noop, noop, noop, noop, noop, noop, noop, noop,
      noop, noop, noop, noop, noop, noop, noop, noop,
      monthlyCloseService as any,
      { add: vi.fn() } as any,
    );

    await processor.process({ name: 'monthly-close-auto-draft', data: {} } as any);

    expect(monthlyCloseService.runAutoDraftForAllUsers).toHaveBeenCalledTimes(1);
  });
});
