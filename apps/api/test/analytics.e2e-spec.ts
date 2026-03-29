import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';

describe('Analytics (e2e)', () => {
  let app: INestApplication;
  let cookies: string[];

  const adminUser = {
    email: `analytics-e2e-${Date.now()}@test.com`,
    password: 'a-very-secure-password-at-least-16-chars',
    displayName: 'Analytics Test User',
  };

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

    // Register and login to get authenticated cookies
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(adminUser);

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: adminUser.email, password: adminUser.password });

    cookies = loginRes.headers['set-cookie'] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/analytics/income-vs-expenses', () => {
    it('should return monthly income and expense rows', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/analytics/income-vs-expenses')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should reject unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .get('/api/analytics/income-vs-expenses')
        .expect(401);
    });

    it('should accept date range filters', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/analytics/income-vs-expenses')
        .query({ from: '2024-01-01', to: '2024-12-31' })
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data).toBeDefined();
    });
  });

  describe('GET /api/analytics/category-breakdown', () => {
    it('should return category breakdown array', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/analytics/category-breakdown')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/analytics/spending-trend', () => {
    it('should return spending trend data with default monthly granularity', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/analytics/spending-trend')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should accept granularity parameter', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/analytics/spending-trend')
        .query({ granularity: 'weekly' })
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data).toBeDefined();
    });
  });

  describe('GET /api/analytics/account-balances', () => {
    it('should return account balances array', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/analytics/account-balances')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/analytics/credit-utilization', () => {
    it('should return credit utilization array', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/analytics/credit-utilization')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/analytics/net-worth', () => {
    it('should return net worth breakdown', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/analytics/net-worth')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(res.body.data).toHaveProperty('assets');
      expect(res.body.data).toHaveProperty('liabilities');
      expect(res.body.data).toHaveProperty('investments');
      expect(res.body.data).toHaveProperty('netWorth');
    });
  });

  describe('GET /api/analytics/top-merchants', () => {
    it('should return top merchants array', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/analytics/top-merchants')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
