import {
  Controller,
  Post,
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

interface ChatBody {
  message: string;
  history?: ChatTurn[];
}

@ApiTags('Advisor')
@Controller('advisor')
@UseGuards(JwtAuthGuard)
export class AdvisorController {
  constructor(private readonly advisor: AdvisorService) {}

  @Get('status')
  @ApiOperation({ summary: 'Whether the advisor is configured, plus the disclaimer' })
  status() {
    return { data: { enabled: this.advisor.enabled, disclaimer: ADVISOR_DISCLAIMER } };
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
