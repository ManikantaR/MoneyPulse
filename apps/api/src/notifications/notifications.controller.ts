import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  UseGuards,
  Post,
  HttpCode,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { WebPushService } from './web-push.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthTokenPayload } from '@moneypulse/shared';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly preferencesService: NotificationPreferencesService,
    private readonly webPush: WebPushService,
  ) {}

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

  @Delete(':id')
  @ApiOperation({ summary: 'Dismiss (delete) a notification' })
  async remove(
    @CurrentUser() user: AuthTokenPayload,
    @Param('id') id: string,
  ) {
    await this.notificationsService.remove(id, user.sub);
    return { data: { dismissed: true } };
  }

  @Post('mark-all-read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark all notifications read' })
  async markAllRead(@CurrentUser() user: AuthTokenPayload) {
    await this.notificationsService.markAllRead(user.sub);
    return { data: { read: true } };
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dismiss a single notification' })
  async dismiss(
    @CurrentUser() user: AuthTokenPayload,
    @Param('id') id: string,
  ) {
    await this.notificationsService.dismiss(id, user.sub);
    return { data: { dismissed: true } };
  }

  @Get('feed/insights')
  @ApiOperation({ summary: 'Get insights feed (filtered, paginated)' })
  async getInsightsFeed(
    @CurrentUser() user: AuthTokenPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('severity') severity?: string,
    @Query('source') source?: string,
    @Query('includeDismissed') includeDismissed?: string,
  ) {
    const severityFilter = severity ? severity.split(',') : undefined;
    const sourceFilter = source ? source.split(',') : undefined;
    const data = await this.notificationsService.getInsightsFeed(user.sub, {
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
      severityFilter,
      sourceFilter,
      includeDismissed: includeDismissed === 'true',
    });
    return { data };
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get all notification preferences for current user' })
  async getPreferences(@CurrentUser() user: AuthTokenPayload) {
    const prefs = await this.preferencesService.getPreferencesForUser(user.sub);
    return { data: prefs };
  }

  @Post('preferences')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update notification preference' })
  async updatePreference(
    @CurrentUser() user: AuthTokenPayload,
    @Body()
    body: {
      notificationType: string;
      mode?: 'instant' | 'brief' | 'off';
      enabledChannels?: string[];
    },
  ) {
    const pref = await this.preferencesService.updatePreference(
      user.sub,
      body.notificationType as any,
      {
        mode: body.mode,
        enabledChannels: body.enabledChannels as any,
      },
    );
    return { data: pref };
  }

  @Get('quiet-hours')
  @ApiOperation({ summary: 'Get current quiet hours setting' })
  async getQuietHours(@CurrentUser() user: AuthTokenPayload) {
    const quietHours = await this.preferencesService.getQuietHours(user.sub);
    return { data: quietHours };
  }

  @Post('quiet-hours')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update quiet hours' })
  async updateQuietHours(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: { start: string; end: string },
  ) {
    const quietHours = await this.preferencesService.updateQuietHours(
      user.sub,
      body.start,
      body.end,
    );
    return { data: quietHours };
  }

  @Post('push-subscription')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a push subscription (Web Push)' })
  async subscribeToPush(
    @CurrentUser() user: AuthTokenPayload,
    @Body()
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      userAgent?: string;
    },
  ) {
    const result = await this.webPush.subscribe(user.sub, subscription);
    return { data: result };
  }

  @Delete('push-subscription')
  @ApiOperation({ summary: 'Unregister a push subscription' })
  async unsubscribeFromPush(
    @CurrentUser() user: AuthTokenPayload,
    @Query('endpoint') endpoint: string,
  ) {
    await this.webPush.unsubscribe(user.sub, endpoint);
    return { data: { unsubscribed: true } };
  }

  @Get('push-vapid-key')
  @ApiOperation({ summary: 'Get VAPID public key for client-side push subscription' })
  async getVapidKey() {
    const vapidKey = this.webPush.getVapidPublicKey();
    return { data: { vapidKey } };
  }

  @Post('test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a test notification through the full pipeline' })
  async sendTest(@CurrentUser() user: AuthTokenPayload) {
    const notification = await this.notificationsService.createAndDispatch({
      userId: user.sub,
      type: 'test',
      title: 'MoneyPulse test',
      message: `Test notification sent at ${new Date().toLocaleTimeString()}.`,
      severity: 'info',
      source: 'system',
      notificationType: 'system_alert',
    });
    return { data: { id: notification.id } };
  }
}
