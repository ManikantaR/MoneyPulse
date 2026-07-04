import {
  Controller,
  Post,
  Put,
  Get,
  Body,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthTokenPayload } from '@moneypulse/shared';
import { AdvisorService, ChatTurn, ADVISOR_DISCLAIMER } from './advisor.service';
import { AdvisorSettingsService } from './advisor-settings.service';
import { LlmProviderFactory } from './llm/provider-factory';
import { DEFAULT_MODELS, type LlmProviderId } from './llm/types';

interface ChatBody {
  message: string;
  history?: ChatTurn[];
}

interface SettingsBody {
  provider?: string;
  model?: string;
  apiKey?: string;
}

@ApiTags('Advisor')
@Controller('advisor')
@UseGuards(JwtAuthGuard)
export class AdvisorController {
  constructor(
    private readonly advisor: AdvisorService,
    private readonly settings: AdvisorSettingsService,
    private readonly factory: LlmProviderFactory,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Whether the advisor is configured, plus the disclaimer' })
  async status() {
    const view = await this.settings.view();
    return {
      data: {
        enabled: view.enabled,
        provider: view.provider,
        model: view.model,
        disclaimer: ADVISOR_DISCLAIMER,
      },
    };
  }

  @Get('settings')
  @ApiOperation({ summary: 'Current advisor provider/model settings (no API key)' })
  async getSettings() {
    return { data: await this.settings.view() };
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update advisor provider/model and optionally the API key' })
  async updateSettings(@Body() body: SettingsBody) {
    const view = await this.settings.update({
      provider: body.provider,
      model: body.model,
      apiKey: body.apiKey,
    });
    return { data: view };
  }

  @Post('settings/test')
  @ApiOperation({ summary: 'Validate the provider credentials (provided or stored)' })
  async testSettings(@Body() body: SettingsBody) {
    try {
      let provider: LlmProviderId;
      let model: string;
      let apiKey: string;

      if (body.apiKey && body.apiKey.trim()) {
        provider = (body.provider as LlmProviderId) ?? 'anthropic';
        model = body.model?.trim() || DEFAULT_MODELS[provider];
        apiKey = body.apiKey.trim();
      } else {
        const resolved = await this.settings.resolve();
        if (!resolved) {
          return { data: { ok: false, error: 'No API key configured.' } };
        }
        ({ provider, model, apiKey } = resolved);
      }

      await this.factory.create(provider, apiKey).testConnection(model);
      return { data: { ok: true } };
    } catch (err: any) {
      return { data: { ok: false, error: err.message ?? 'Connection failed.' } };
    }
  }

  @Post('chat')
  @ApiOperation({ summary: 'Ask the advisor a question (Server-Sent Events stream)' })
  async chat(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: ChatBody,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (payload: Record<string, unknown>) =>
      res.write(`data: ${JSON.stringify(payload)}\n\n`);

    const message = (body?.message ?? '').trim();
    if (!message) {
      send({ type: 'error', text: 'Empty message.' });
      res.end();
      return;
    }

    try {
      for await (const delta of this.advisor.streamChat(
        user.sub,
        message,
        body.history ?? [],
      )) {
        send({ type: 'delta', text: delta });
      }
      send({ type: 'done' });
    } catch (err: any) {
      send({ type: 'error', text: err.message ?? 'Advisor error.' });
    } finally {
      res.end();
    }
  }
}
