import { Module } from '@nestjs/common';
import { SanitizerV2Service } from './sanitizer-v2.service';
import { AliasMapperService } from './alias-mapper.service';
import { SigningService } from './signing.service';
import { SyncDeliveryService } from './sync-delivery.service';
import { OutboxService } from './outbox.service';
import { SyncBackfillService } from './sync-backfill.service';
import { SyncController } from './sync.controller';

@Module({
  controllers: [SyncController],
  providers: [
    SanitizerV2Service,
    AliasMapperService,
    SigningService,
    SyncDeliveryService,
    OutboxService,
    SyncBackfillService,
  ],
  exports: [
    SanitizerV2Service,
    AliasMapperService,
    SigningService,
    SyncDeliveryService,
    OutboxService,
    SyncBackfillService,
  ],
})
export class SyncModule {}
