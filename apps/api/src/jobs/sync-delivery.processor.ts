import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SyncDeliveryService } from '../sync/sync-delivery.service';

@Processor('sync-delivery')
export class SyncDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncDeliveryProcessor.name);

  constructor(private readonly syncDelivery: SyncDeliveryService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'deliver-pending-sync') {
      this.logger.warn(`Unknown sync job: ${job.name}`);
      return;
    }

    const delivered = await this.syncDelivery.deliverPending();
    this.logger.log(`Sync delivery sweep processed ${delivered} events`);
  }
}
