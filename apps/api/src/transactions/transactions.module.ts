import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { ExportService } from './export.service';
import { AttachmentService } from './attachment.service';
import { AttachmentController } from './attachment.controller';
import { AttachmentDownloadController } from './attachment-download.controller';
import { CategorizationModule } from '../categorization/categorization.module';
import { SyncModule } from '../sync/sync.module';
import { INGESTION_QUEUE } from '@moneypulse/shared';

@Module({
  imports: [
    CategorizationModule,
    SyncModule,
    BullModule.registerQueue({ name: INGESTION_QUEUE }),
  ],
  providers: [TransactionsService, ExportService, AttachmentService],
  controllers: [
    TransactionsController,
    AttachmentController,
    AttachmentDownloadController,
  ],
  exports: [TransactionsService],
})
export class TransactionsModule {}
