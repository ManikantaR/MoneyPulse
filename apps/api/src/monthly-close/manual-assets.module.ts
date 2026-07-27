import { Module } from '@nestjs/common';
import { ManualAssetsService } from './manual-assets.service';
import { ManualAssetsController } from './manual-assets.controller';

@Module({
  providers: [ManualAssetsService],
  controllers: [ManualAssetsController],
  exports: [ManualAssetsService],
})
export class ManualAssetsModule {}
