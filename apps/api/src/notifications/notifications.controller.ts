import {
  Controller,
  Get,
  Patch,
  Param,
  UseGuards,
  Post,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthTokenPayload } from '@moneypulse/shared';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for current user' })
  async findAll(@CurrentUser() user: AuthTokenPayload) {
    const data = await this.notificationsService.findByUser(user.sub);
    return { data };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  async unreadCount(@CurrentUser() user: AuthTokenPayload) {
    const count = await this.notificationsService.unreadCount(user.sub);
    return { data: { count } };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  async markRead(
    @CurrentUser() user: AuthTokenPayload,
    @Param('id') id: string,
  ) {
    await this.notificationsService.markRead(id, user.sub);
    return { data: { read: true } };
  }

  @Post('mark-all-read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark all notifications read' })
  async markAllRead(@CurrentUser() user: AuthTokenPayload) {
    await this.notificationsService.markAllRead(user.sub);
    return { data: { read: true } };
  }
}
