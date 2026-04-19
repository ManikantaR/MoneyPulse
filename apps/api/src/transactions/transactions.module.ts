import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { ExportService } from './export.service';
import { CategorizationModule } from '../categorization/categorization.module';

@Module({
  imports: [CategorizationModule],
  providers: [TransactionsService, ExportService],
  controllers: [TransactionsController],
  exports: [TransactionsService],
})
export class TransactionsModule {}
