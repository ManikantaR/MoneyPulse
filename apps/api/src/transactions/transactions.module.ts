import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { ExportService } from './export.service';
import { AttachmentService } from './attachment.service';
import { AttachmentController } from './attachment.controller';
import { AttachmentDownloadController } from './attachment-download.controller';
import { CategorizationModule } from '../categorization/categorization.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [CategorizationModule, SyncModule],
  providers: [TransactionsService, ExportService, AttachmentService],
  controllers: [
    TransactionsController,
    AttachmentController,
    AttachmentDownloadController,
  ],
  exports: [TransactionsService],
})
export class TransactionsModule {}
