import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ThrottleLoginGuard } from '../common/guards/throttle-login.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  registerSchema,
  changePasswordSchema,
} from '@moneypulse/shared';
import type {
  AuthTokenPayload,
  RegisterInput,
  ChangePasswordInput,
} from '@moneypulse/shared';

const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register first admin user (only when no users exist)',
  })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
  ) {
    const user = await this.authService.register(body, req.ip ?? null);
    return { data: { user } };
  }

  @Post('login')
  @UseGuards(ThrottleLoginGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { email, password } = req.body;
    const user = await this.authService.validateUser(email, password);

    if (!user) {
      await this.authService.logLoginFailed(email, req.ip ?? null);
      throw new UnauthorizedException('Invalid email or password');
    }

    const deviceId = req.cookies?.device_id ?? null;
    const result = await this.authService.login(
      user,
      deviceId,
      req.ip ?? null,
    );

    this.setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken,
      result.deviceId,
    );

    return {
      data: {
        user: result.user,
        mustChangePassword: result.mustChangePassword,
      },
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token cookie' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      this.clearAuthCookies(res);
      return { data: null };
    }

    const result = await this.authService.refresh(refreshToken);

    this.setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken,
      result.deviceId,
    );

    return { data: { refreshed: true } };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke session' })
  async logout(
    @CurrentUser() user: AuthTokenPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const deviceId = req.cookies?.device_id;
    if (deviceId) {
      await this.authService.logout(user.sub, deviceId);
    }

    this.clearAuthCookies(res);

    return { data: { loggedOut: true } };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current authenticated user' })
  async me(@CurrentUser() user: AuthTokenPayload) {
    return { data: user };
  }

  @Get('registration-status')
  @ApiOperation({ summary: 'Check if first-user registration is open' })
  async registrationStatus() {
    const open = await this.authService.isRegistrationOpen();
    return { data: { registrationOpen: open } };
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change password (also clears mustChangePassword flag)',
  })
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @CurrentUser() user: AuthTokenPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.changePassword(user.sub, body, req.ip ?? null);

    this.clearAuthCookies(res);

    return { data: { passwordChanged: true } };
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
    deviceId: string,
  ): void {
    res.cookie('access_token', accessToken, {
      ...COOKIE_BASE,
      maxAge: this.tokenService.getAccessTokenTtlMs(),
    });

    res.cookie('refresh_token', refreshToken, {
      ...COOKIE_BASE,
      maxAge: this.tokenService.getRefreshTokenTtlMs(),
      path: '/api/auth/refresh',
    });

    res.cookie('device_id', deviceId, {
      ...COOKIE_BASE,
      httpOnly: true,
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/api/auth/refresh' });
  }
}
