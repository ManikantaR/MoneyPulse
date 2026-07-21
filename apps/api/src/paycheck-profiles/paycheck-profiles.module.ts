import { Module } from '@nestjs/common';
import { PaycheckProfilesService } from './paycheck-profiles.service';
import { PaycheckProfilesController } from './paycheck-profiles.controller';

@Module({
  providers: [PaycheckProfilesService],
  controllers: [PaycheckProfilesController],
  exports: [PaycheckProfilesService],
})
export class PaycheckProfilesModule {}
