import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
} from '@nestjs/swagger';
import { Request } from 'express';
import { UsersService } from './users.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  inviteUserSchema,
  updateUserSettingsSchema,
} from '@moneypulse/shared';
import type {
  AuthTokenPayload,
  InviteUserInput,
  UpdateUserSettingsInput,
} from '@moneypulse/shared';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  @Post('invite')
  @Roles('admin')
  @HttpCode(201)
  @ApiOperation({ summary: 'Admin invite — create user with temp password' })
  async invite(
    @Body(new ZodValidationPipe(inviteUserSchema)) body: InviteUserInput,
    @CurrentUser() currentUser: AuthTokenPayload,
    @Req() req: Request,
  ) {
    const result = await this.usersService.invite(
      body,
      currentUser.householdId,
    );

    await this.auditService.log({
      userId: currentUser.sub,
      action: 'role_changed',
      entityType: 'user',
      entityId: result.user.id,
      newValue: { email: body.email, role: body.role },
      ipAddress: req.ip ?? null,
    });

    return {
      data: {
        user: this.sanitizeUser(result.user),
        temporaryPassword: result.temporaryPassword,
      },
    };
  }

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'List all users (admin only)' })
  async list() {
    const users = await this.usersService.listUsers();
    return { data: users };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile + settings' })
  async getMe(@CurrentUser() currentUser: AuthTokenPayload) {
    const user = await this.usersService.findById(currentUser.sub);
    const settings = await this.usersService.getSettings(currentUser.sub);
    const household = currentUser.householdId
      ? await this.usersService.getHousehold(currentUser.householdId)
      : null;

    return {
      data: {
        user: this.sanitizeUser(user),
        settings,
        household,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update user settings' })
  async updateSettings(
    @Body(new ZodValidationPipe(updateUserSettingsSchema)) body: UpdateUserSettingsInput,
    @CurrentUser() currentUser: AuthTokenPayload,
  ) {
    const settings = await this.usersService.updateSettings(
      currentUser.sub,
      body,
    );
    return { data: settings };
  }

  @Post('household')
  @Roles('admin')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a household (admin only)' })
  async createHousehold(
    @Body() body: { name: string },
    @CurrentUser() currentUser: AuthTokenPayload,
  ) {
    const household = await this.usersService.createHousehold(body.name);
    await this.usersService.assignUserToHousehold(currentUser.sub, household.id);
    return { data: household };
  }

  @Post('household/members/:userId')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: "Assign user to admin's household" })
  async addToHousehold(
    @Param('userId') userId: string,
    @CurrentUser() currentUser: AuthTokenPayload,
  ) {
    if (!currentUser.householdId) {
      throw new BadRequestException('Create a household first');
    }
    await this.usersService.assignUserToHousehold(userId, currentUser.householdId);
    return { data: { assigned: true } };
  }

  @Delete('household/members/:userId')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove user from household' })
  async removeFromHousehold(@Param('userId') userId: string) {
    await this.usersService.removeUserFromHousehold(userId);
    return { data: { removed: true } };
  }

  @Get('household/members')
  @ApiOperation({ summary: 'List household members' })
  async listHouseholdMembers(@CurrentUser() currentUser: AuthTokenPayload) {
    if (!currentUser.householdId) {
      return { data: [] };
    }
    const members = await this.usersService.listHouseholdMembers(currentUser.householdId);
    return { data: members };
  }

  private sanitizeUser(user: any): any {
    const { passwordHash, ...safe } = user;
    return safe;
  }
}
