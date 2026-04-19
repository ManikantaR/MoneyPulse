import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AiLogsService } from './ai-logs.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('AI Logs')
@Controller('ai-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AiLogsController {
  constructor(private readonly aiLogsService: AiLogsService) {}

  @Get()
  @ApiOperation({ summary: 'List AI prompt logs' })
  async list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('promptType') promptType?: string,
  ) {
    const { rows, total } = await this.aiLogsService.findAll({
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
      promptType,
    });
    return { data: rows, total };
  }

  @Get('stats')
  @ApiOperation({ summary: 'AI model performance stats' })
  async stats() {
    const data = await this.aiLogsService.getStats();
    return { data };
  }

  @Get('pii-alerts')
  @ApiOperation({ summary: 'Recent PII detection alerts' })
  async piiAlerts(@Query('limit') limit?: string) {
    const data = await this.aiLogsService.getRecentPiiAlerts(
      limit ? parseInt(limit, 10) : 20,
    );
    return { data };
  }
}
