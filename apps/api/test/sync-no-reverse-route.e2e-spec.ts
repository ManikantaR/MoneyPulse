import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';

describe('Sync Boundary (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not expose reverse sync mutation routes', async () => {
    const candidates = [
      '/api/sync/import',
      '/api/sync/apply',
      '/api/firebase/pull',
    ];

    for (const path of candidates) {
      const response = await request(app.getHttpServer()).post(path).send({});
      expect(response.status).toBe(404);
    }
  });
});
