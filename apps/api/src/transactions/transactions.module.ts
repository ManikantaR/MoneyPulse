import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { ExportService } from './export.service';

@Module({
  providers: [TransactionsService, ExportService],
  controllers: [TransactionsController],
  exports: [TransactionsService],
})
export class TransactionsModule {}
