import { Module } from '@nestjs/common';
import { SetupProgressService } from './setup-progress.service';
import { SetupProgressController } from './setup-progress.controller';

@Module({
  providers: [SetupProgressService],
  controllers: [SetupProgressController],
  exports: [SetupProgressService],
})
export class SettingsModule {}
