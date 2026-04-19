import { Module } from '@nestjs/common';
import { AiLogsService } from './ai-logs.service';
import { AiLogsController } from './ai-logs.controller';

@Module({
  providers: [AiLogsService],
  controllers: [AiLogsController],
  exports: [AiLogsService],
})
export class AiLogsModule {}
