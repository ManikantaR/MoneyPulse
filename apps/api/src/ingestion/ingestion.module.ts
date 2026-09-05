import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { INGESTION_QUEUE } from '@moneypulse/shared';
import { IngestionService } from './ingestion.service';
import {
  IngestionController,
  IngestionEventsController,
} from './ingestion.controller';
import { DedupService } from './dedup.service';
import { ArchiverService } from './archiver.service';
import { WatcherService } from './watcher.service';
import { IngestionProcessor } from '../jobs/ingestion.processor';
import { PdfProxyService } from './parsers/pdf-proxy.service';
import { AuditModule } from '../audit/audit.module';
import { CategorizationModule } from '../categorization/categorization.module';
import { SyncModule } from '../sync/sync.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { BillsModule } from '../bills/bills.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: INGESTION_QUEUE }),
    BullModule.registerQueue({ name: 'alerts' }),
    AuditModule,
    CategorizationModule,
    SyncModule,
    AnalyticsModule,
    EmbeddingsModule,
    BillsModule,
  ],
  controllers: [IngestionController, IngestionEventsController],
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

    // 11.10 backfill sweep: catches transactions that never got an embedding
    // (Ollama was down, retries exhausted, or imported before this feature
    // shipped). Runs only when Ollama is up (see processor health gate).
    await this.ingestionQueue.upsertJobScheduler(
      'embed-reconcile-sweep',
      { every: 15 * 60 * 1000 }, // every 15 minutes
      { name: 'embed-reconcile' },
    );

    // Backfill sweep: catches users whose recurring bills were never detected
    // (imported before the per-import redetect hook existed). Daily is plenty —
    // detection only needs to run once per user's data to populate the
    // Subscriptions dashboard stat, and it's idempotent to re-run.
    await this.ingestionQueue.upsertJobScheduler(
      'bills-redetect-sweep',
      { every: 24 * 60 * 60 * 1000 }, // every 24 hours
      { name: 'bills-redetect' },
    );

    // Phase 0 / BS-6: stalled-job sweep. A `file_uploads` row can get stuck in
    // 'processing' (or 'pending' after being enqueued) forever if the worker
    // crashes/is killed mid-job or a BullMQ job is lost — with no error and no
    // visibility. Every 15 minutes, flip anything older than the stall
    // threshold to 'failed' with an explanatory errorLog so it's visible and
    // re-runnable (dedup makes re-drop/re-ingest safe).
    await this.ingestionQueue.upsertJobScheduler(
      'stalled-upload-sweep',
      { every: 15 * 60 * 1000 }, // every 15 minutes
      { name: 'stalled-upload-reconcile' },
    );
  }
}
