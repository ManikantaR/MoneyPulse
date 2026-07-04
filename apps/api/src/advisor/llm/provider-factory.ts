import { Injectable } from '@nestjs/common';
import type { LlmProvider, LlmProviderId } from './types';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAIProvider } from './openai.provider';

/** Constructs the right provider adapter for a resolved (provider, apiKey) pair. */
@Injectable()
export class LlmProviderFactory {
  create(provider: LlmProviderId, apiKey: string): LlmProvider {
    switch (provider) {
      case 'anthropic':
        return new AnthropicProvider(apiKey);
      case 'openai':
        return new OpenAIProvider(apiKey);
      default:
        throw new Error(`Unknown LLM provider: ${provider as string}`);
    }
  }
}
