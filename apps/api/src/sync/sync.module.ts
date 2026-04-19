import { Module } from '@nestjs/common';
import { SanitizerV2Service } from './sanitizer-v2.service';
import { AliasMapperService } from './alias-mapper.service';
import { SigningService } from './signing.service';
import { SyncDeliveryService } from './sync-delivery.service';

@Module({
  providers: [
    SanitizerV2Service,
    AliasMapperService,
    SigningService,
    SyncDeliveryService,
  ],
  exports: [
    SanitizerV2Service,
    AliasMapperService,
    SigningService,
    SyncDeliveryService,
  ],
})
export class SyncModule {}
