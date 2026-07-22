import { Module } from '@nestjs/common';
import { SuitabilitySettingsService } from './suitability-settings.service';
import { SuitabilitySettingsController } from './suitability-settings.controller';

@Module({
  providers: [SuitabilitySettingsService],
  controllers: [SuitabilitySettingsController],
  exports: [SuitabilitySettingsService],
})
export class SuitabilitySettingsModule {}
