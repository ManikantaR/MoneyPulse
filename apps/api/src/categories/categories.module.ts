import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { RulesController } from './rules.controller';

@Module({
  controllers: [CategoriesController, RulesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
