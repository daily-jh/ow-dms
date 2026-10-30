import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { createPool } from '@owdms/db';
import { loadConfig, type ApiConfig } from './config';
import { HealthController, LedgerController, SettingsController } from './controllers';
import { AdminController, AuthController } from './auth.controllers';
import { ErrorFilter, requestId } from './http';
import { RUNTIME, Runtime } from './runtime';

export async function createApp(config: ApiConfig = loadConfig()): Promise<{ app: INestApplication; runtime: Runtime }> {
  const runtime = new Runtime(createPool(config.databaseUrl), config);

  @Module({
    controllers: [HealthController, AuthController, AdminController, LedgerController, SettingsController],
    providers: [{ provide: RUNTIME, useValue: runtime }],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'], bodyParser: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Request-Id', requestId(req));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return { app, runtime };
}
