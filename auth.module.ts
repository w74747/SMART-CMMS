// =============================================================================
// src/app.module.ts
// Smart CMMS — Root Application Module
//
// Wires together:
//   - Configuration & environment validation
//   - Database (PrismaModule — global)
//   - Multi-tenant middleware (applied to ALL routes except excluded paths)
//   - Rate limiting (Throttler)
//   - Scheduled tasks (PM auto-generation engine lives here)
//   - Event emitter (WO lifecycle events → inventory deduction, notifications)
//   - Feature modules
// =============================================================================
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { validateEnv }                 from './common/config/env.validation';
import { GlobalHttpExceptionFilter }   from './common/filters/http-exception.filter';
import { TransformInterceptor }        from './common/interceptors/transform.interceptor';
import { LoggingInterceptor }          from './common/interceptors/logging.interceptor';
import { TenantMiddleware }            from './common/middleware/tenant.middleware';
import { PrismaModule }                from './prisma/prisma.module';
import { AuthModule }                  from './auth/auth.module';
import { StorageService }              from './common/services/storage.service';
import { AppController }               from './app.controller';

@Module({
  imports: [
    // ── Environment & Config ──────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal:  true,          // ConfigService injectable everywhere
      validate:  validateEnv,   // Fail-fast on missing vars
      cache:     true,          // Cache parsed env for performance
    }),

    // ── Database (Platform-level) ─────────────────────────────────────────
    PrismaModule,               // Global — no need to import in feature modules

    // ── Rate Limiting ─────────────────────────────────────────────────────
    ThrottlerModule.forRootAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name:  'default',
            ttl:   config.get<number>('THROTTLE_TTL_SECONDS', 60) * 1000,
            limit: config.get<number>('THROTTLE_LIMIT_PER_MINUTE', 100),
          },
        ],
        // Use Redis for distributed rate limiting in multi-instance deploys
        // storage: new ThrottlerStorageRedisService(redisClient),
      }),
    }),

    // ── Scheduled Tasks ───────────────────────────────────────────────────
    // PM auto-generation scheduler and cleanup tasks use this
    ScheduleModule.forRoot(),

    // ── Event System ──────────────────────────────────────────────────────
    // Enables decoupled event-driven communication between modules:
    //   'work-order.completed' → inventory.deduct, notification.send, audit.log
    //   'meter-reading.anomaly' → work-order.auto-create, notification.push
    EventEmitterModule.forRoot({
      wildcard:         true,   // Support wildcards: 'work-order.*'
      delimiter:        '.',
      newListener:      false,
      removeListener:   false,
      maxListeners:     20,
      verboseMemoryLeak: true,
      ignoreErrors:     false,
    }),

    // ── Feature Modules ───────────────────────────────────────────────────
    AuthModule,
    // TenantsModule,     ← Next batch
    // UsersModule,       ← Next batch
    // AssetsModule,      ← Next batch
    // WorkOrdersModule,  ← Next batch
    // InventoryModule,   ← Next batch
    // MeterReadingsModule,
    // PmPlansModule,
    // NotificationsModule,
    // ReportsModule,
    // KpiModule,
  ],

  controllers: [AppController],

  providers: [
    // ── Global Providers ──────────────────────────────────────────────────
    StorageService,

    // ── Global Guards ─────────────────────────────────────────────────────
    {
      provide:  APP_GUARD,
      useClass: ThrottlerGuard,   // Rate limiting on ALL endpoints
    },

    // ── Global Filters ────────────────────────────────────────────────────
    {
      provide:  APP_FILTER,
      useClass: GlobalHttpExceptionFilter,   // Unified error response shape
    },

    // ── Global Interceptors ───────────────────────────────────────────────
    {
      provide:  APP_INTERCEPTOR,
      useClass: LoggingInterceptor,          // Request/response logging
    },
    {
      provide:  APP_INTERCEPTOR,
      useClass: TransformInterceptor,        // Wrap responses: { success, data, timestamp }
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * Apply TenantMiddleware to ALL routes globally.
   *
   * The middleware itself handles route exclusions (auth, health, super-admin)
   * via the EXCLUDED_ROUTE_PREFIXES list in tenant.middleware.ts.
   *
   * WHY GLOBAL vs CONTROLLER-LEVEL:
   *   Applying at the module level ensures NO tenant-scoped route can accidentally
   *   be reached without a validated tenant context. A controller-level guard
   *   could be forgotten; this cannot be forgotten.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
