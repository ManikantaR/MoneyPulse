import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';

describe('Budgets (e2e)', () => {
  let app: INestApplication;
  let cookies: string[];
  let createdBudgetId: string;
  let createdGoalId: string;

  const testUser = {
    email: 'budget-test@test.com',
    password: 'a-very-secure-password-at-least-16-chars',
    displayName: 'Budget Test User',
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

    // Register + login to get auth cookies
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser);

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: testUser.email, password: testUser.password });

    cookies = loginRes.headers['set-cookie'] ?? [];
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Budgets ────────────────────────────────────────

  describe('GET /api/budgets', () => {
    it('should return empty budgets initially', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/budgets')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data).toEqual([]);
    });

    it('should return 401 without auth', async () => {
      await request(app.getHttpServer())
        .get('/api/budgets')
        .expect(401);
    });
  });

  describe('POST /api/budgets', () => {
    it('should reject invalid budget (missing fields)', async () => {
      await request(app.getHttpServer())
        .post('/api/budgets')
        .set('Cookie', cookies)
        .send({})
        .expect(400);
    });

    it('should create a budget with valid input', async () => {
      // Get a category ID first
      const catRes = await request(app.getHttpServer())
        .get('/api/categories')
        .set('Cookie', cookies);

      const categoryId = catRes.body.data?.[0]?.id;
      if (!categoryId) {
        // If no categories seeded, skip
        return;
      }

      const res = await request(app.getHttpServer())
        .post('/api/budgets')
        .set('Cookie', cookies)
        .send({
          categoryId,
          amountCents: 50000,
          period: 'monthly',
        })
        .expect(201);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.amountCents).toBe(50000);
      createdBudgetId = res.body.data.id;
    });
  });

  describe('PATCH /api/budgets/:id', () => {
    it('should update a budget', async () => {
      if (!createdBudgetId) return;

      const res = await request(app.getHttpServer())
        .patch(`/api/budgets/${createdBudgetId}`)
        .set('Cookie', cookies)
        .send({ amountCents: 75000 })
        .expect(200);

      expect(res.body.data.amountCents).toBe(75000);
    });

    it('should return 404 for non-existent budget', async () => {
      await request(app.getHttpServer())
        .patch('/api/budgets/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookies)
        .send({ amountCents: 10000 })
        .expect(404);
    });
  });

  describe('DELETE /api/budgets/:id', () => {
    it('should soft delete the budget', async () => {
      if (!createdBudgetId) return;

      const res = await request(app.getHttpServer())
        .delete(`/api/budgets/${createdBudgetId}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data.deleted).toBe(true);
    });
  });

  // ── Savings Goals ────────────────────────────────────

  describe('GET /api/savings-goals', () => {
    it('should return empty goals initially', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/savings-goals')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data).toEqual([]);
    });
  });

  describe('POST /api/savings-goals', () => {
    it('should reject invalid goal', async () => {
      await request(app.getHttpServer())
        .post('/api/savings-goals')
        .set('Cookie', cookies)
        .send({})
        .expect(400);
    });

    it('should create a savings goal', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/savings-goals')
        .set('Cookie', cookies)
        .send({
          name: 'Vacation Fund',
          targetAmountCents: 200000,
        })
        .expect(201);

      expect(res.body.data.name).toBe('Vacation Fund');
      expect(res.body.data.currentAmountCents).toBe(0);
      createdGoalId = res.body.data.id;
    });
  });

  describe('POST /api/savings-goals/:id/contribute', () => {
    it('should reject non-positive amounts', async () => {
      if (!createdGoalId) return;

      await request(app.getHttpServer())
        .post(`/api/savings-goals/${createdGoalId}/contribute`)
        .set('Cookie', cookies)
        .send({ amountCents: 0 })
        .expect(400);
    });

    it('should add funds to the goal', async () => {
      if (!createdGoalId) return;

      const res = await request(app.getHttpServer())
        .post(`/api/savings-goals/${createdGoalId}/contribute`)
        .set('Cookie', cookies)
        .send({ amountCents: 5000 })
        .expect(201);

      expect(Number(res.body.data.currentAmountCents)).toBe(5000);
    });
  });

  describe('PATCH /api/savings-goals/:id', () => {
    it('should update a goal name', async () => {
      if (!createdGoalId) return;

      const res = await request(app.getHttpServer())
        .patch(`/api/savings-goals/${createdGoalId}`)
        .set('Cookie', cookies)
        .send({ name: 'Holiday Fund' })
        .expect(200);

      expect(res.body.data.name).toBe('Holiday Fund');
    });
  });

  describe('DELETE /api/savings-goals/:id', () => {
    it('should soft delete a goal', async () => {
      if (!createdGoalId) return;

      const res = await request(app.getHttpServer())
        .delete(`/api/savings-goals/${createdGoalId}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data.deleted).toBe(true);
    });
  });

  // ── Notifications ────────────────────────────────────

  describe('GET /api/notifications', () => {
    it('should return notifications for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Cookie', cookies)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/notifications/unread-count', () => {
    it('should return unread count', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .set('Cookie', cookies)
        .expect(200);

      expect(typeof res.body.data.count).toBe('number');
    });
  });

  describe('POST /api/notifications/mark-all-read', () => {
    it('should mark all as read', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/notifications/mark-all-read')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data.read).toBe(true);
    });
  });
});
