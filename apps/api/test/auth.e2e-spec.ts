import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { REDIS_CLIENT } from '../src/redis/redis.provider';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const adminUser = {
    email: 'admin@test.com',
    password: 'a-very-secure-password-at-least-16-chars',
    displayName: 'Admin User',
  };

  let cookies: string[];

  describe('POST /api/auth/registration-status', () => {
    it('should report registration is open', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/registration-status')
        .expect(200);

      expect(res.body.data.registrationOpen).toBe(true);
    });
  });

  describe('POST /api/auth/register', () => {
    it('should register first user as admin', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(adminUser)
        .expect(201);

      expect(res.body.data.user.email).toBe(adminUser.email);
      expect(res.body.data.user.role).toBe('admin');
      expect(res.body.data.user.passwordHash).toBeUndefined();
    });

    it('should reject second registration', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'second@test.com',
          password: 'another-password-at-least-16-chars',
          displayName: 'Second User',
        })
        .expect(403);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login and set cookies', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: adminUser.email, password: adminUser.password })
        .expect(200);

      expect(res.body.data.user.email).toBe(adminUser.email);
      expect(res.headers['set-cookie']).toBeDefined();

      // Store cookies for subsequent requests
      cookies = res.headers['set-cookie'] as unknown as string[];

      // Verify cookies include access_token and refresh_token
      const cookieNames = cookies.map((c: string) => c.split('=')[0]);
      expect(cookieNames).toContain('access_token');
      expect(cookieNames).toContain('refresh_token');
      expect(cookieNames).toContain('device_id');
    });

    it('should reject wrong password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: adminUser.email, password: 'wrong-password-is-wrong' })
        .expect(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user with cookies', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data.sub).toBeDefined();
      expect(res.body.data.email).toBe(adminUser.email);
      expect(res.body.data.role).toBe('admin');
    });

    it('should 401 without cookies', async () => {
      await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh tokens and set new cookies', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data.refreshed).toBe(true);
      expect(res.headers['set-cookie']).toBeDefined();

      // Update cookies for subsequent requests
      cookies = res.headers['set-cookie'] as unknown as string[];
    });
  });

  describe('POST /api/users/invite', () => {
    it('should invite a member (admin only)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users/invite')
        .set('Cookie', cookies)
        .send({
          email: 'member@test.com',
          displayName: 'Family Member',
          role: 'member',
        })
        .expect(201);

      expect(res.body.data.user.email).toBe('member@test.com');
      expect(res.body.data.user.role).toBe('member');
      expect(res.body.data.temporaryPassword).toBeDefined();
      expect(res.body.data.temporaryPassword.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('Force password change flow', () => {
    let memberCookies: string[];

    beforeAll(async () => {
      // Clear login rate-limit keys so prior logins across test files don't cause 429
      const redis = app.get<Redis>(REDIS_CLIENT);
      const keys = await redis.keys('login_throttle:*');
      if (keys.length) await redis.del(...keys);
    });

    it('invited user should login with temp password', async () => {
      const inviteRes = await request(app.getHttpServer())
        .post('/api/users/invite')
        .set('Cookie', cookies)
        .send({
          email: 'member2@test.com',
          displayName: 'Member Two',
          role: 'member',
        })
        .expect(201);

      const tempPassword = inviteRes.body.data.temporaryPassword;

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'member2@test.com', password: tempPassword })
        .expect(200);

      expect(loginRes.body.data.mustChangePassword).toBe(true);
      memberCookies = loginRes.headers['set-cookie'] as unknown as string[];
    });

    it('should change password successfully', async () => {
      const inviteRes = await request(app.getHttpServer())
        .post('/api/users/invite')
        .set('Cookie', cookies)
        .send({
          email: 'member3@test.com',
          displayName: 'Member Three',
          role: 'member',
        })
        .expect(201);

      const tempPassword = inviteRes.body.data.temporaryPassword;

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'member3@test.com', password: tempPassword })
        .expect(200);

      const memberCookies3 = loginRes.headers[
        'set-cookie'
      ] as unknown as string[];

      await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set('Cookie', memberCookies3)
        .send({
          currentPassword: tempPassword,
          newPassword: 'my-brand-new-secure-password-here',
        })
        .expect(200);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout and clear cookies', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data.loggedOut).toBe(true);
    });
  });
});
