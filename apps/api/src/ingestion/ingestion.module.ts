import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { INGESTION_QUEUE } from '@moneypulse/shared';
import { IngestionService } from './ingestion.service';
import { IngestionController } from './ingestion.controller';
import { DedupService } from './dedup.service';
import { ArchiverService } from './archiver.service';
import { WatcherService } from './watcher.service';
import { IngestionProcessor } from '../jobs/ingestion.processor';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: INGESTION_QUEUE }),
    AuditModule,
  ],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    DedupService,
    ArchiverService,
    WatcherService,
    IngestionProcessor,
  ],
  exports: [IngestionService, DedupService],
})
export class IngestionModule {}
