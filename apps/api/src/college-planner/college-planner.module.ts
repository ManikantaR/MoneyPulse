import { Module } from '@nestjs/common';
import { CollegePlannerController } from './college-planner.controller';

@Module({
  controllers: [CollegePlannerController],
})
export class CollegePlannerModule {}
