import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { INGESTION_QUEUE } from '@moneypulse/shared';
import { IngestionService } from './ingestion.service';
import { IngestionController } from './ingestion.controller';
import { DedupService } from './dedup.service';
import { ArchiverService } from './archiver.service';
import { WatcherService } from './watcher.service';
import { IngestionProcessor } from '../jobs/ingestion.processor';
import { PdfProxyService } from './parsers/pdf-proxy.service';
import { AuditModule } from '../audit/audit.module';
import { CategorizationModule } from '../categorization/categorization.module';
import { SyncModule } from '../sync/sync.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: INGESTION_QUEUE }),
    BullModule.registerQueue({ name: 'alerts' }),
    AuditModule,
    CategorizationModule,
    SyncModule,
    AnalyticsModule,
  ],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    DedupService,
    ArchiverService,
    WatcherService,
    PdfProxyService,
    IngestionProcessor,
  ],
  exports: [IngestionService, DedupService, PdfProxyService],
})
export class IngestionModule implements OnModuleInit {
  constructor(
    @InjectQueue(INGESTION_QUEUE) private readonly ingestionQueue: Queue,
  ) {}

  async onModuleInit() {
    // Safety-net sweep: re-enqueue ai-categorize for any transactions that are
    // still uncategorized (Ollama was down when originally imported, or the job
    // exhausted its retries during a long outage).  Runs only when Ollama is up.
    await this.ingestionQueue.upsertJobScheduler(
      'ai-reconcile-sweep',
      { every: 15 * 60 * 1000 }, // every 15 minutes
      { name: 'ai-reconcile' },
    );
  }
}
