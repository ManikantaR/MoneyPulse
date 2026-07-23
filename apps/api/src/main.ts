import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Behind Traefik: trust exactly one hop so req.ip resolves the real client
  // (X-Forwarded-For) instead of Traefik's own address for every request —
  // without this, IP-keyed guards like ThrottleLoginGuard see one shared IP
  // for the whole LAN and rate-limit everyone together.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  });

  // Swagger: only expose in development
  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('MoneyPulse API')
      .setDescription('Personal Finance Tracker API')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('access_token')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    console.log(`Swagger docs at http://localhost:${process.env.PORT || 4000}/api/docs`);
  }

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`MoneyPulse API running on http://localhost:${port}`);
}
bootstrap();
