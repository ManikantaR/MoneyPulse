import { Module } from '@nestjs/common';
import { OllamaEmbeddingService } from './ollama-embedding.service';
import { EmbeddingService } from './embedding.service';
import { EmbeddingCategorizerService } from './embedding-categorizer.service';
import { AiLogsModule } from '../ai-logs/ai-logs.module';

@Module({
  imports: [AiLogsModule],
  providers: [OllamaEmbeddingService, EmbeddingService, EmbeddingCategorizerService],
  exports: [OllamaEmbeddingService, EmbeddingService, EmbeddingCategorizerService],
})
export class EmbeddingsModule {}
