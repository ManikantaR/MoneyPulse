import { Module } from '@nestjs/common';
import { SanitizerV2Service } from './sanitizer-v2.service';
import { AliasMapperService } from './alias-mapper.service';
import { SigningService } from './signing.service';
import { SyncDeliveryService } from './sync-delivery.service';
import { OutboxService } from './outbox.service';

@Module({
  providers: [
    SanitizerV2Service,
    AliasMapperService,
    SigningService,
    SyncDeliveryService,
    OutboxService,
  ],
  exports: [
    SanitizerV2Service,
    AliasMapperService,
    SigningService,
    SyncDeliveryService,
    OutboxService,
  ],
})
export class SyncModule {}
