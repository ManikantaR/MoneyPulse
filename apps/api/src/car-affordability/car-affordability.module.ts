import { Module } from '@nestjs/common';
import { CarAffordabilityController } from './car-affordability.controller';

@Module({
  controllers: [CarAffordabilityController],
})
export class CarAffordabilityModule {}
