// =============================================================================
// src/common/decorators/tenant-context.decorator.ts
// Custom parameter decorators for extracting tenant context in controllers
// =============================================================================

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import {
  TenantRequestContext,
} from '../middleware/tenant.middleware';

/**
 * @TenantCtx() — Extracts the full TenantRequestContext from the request.
 *
 * Usage in controller:
 *   @Get('/assets')
 *   async getAssets(@TenantCtx() ctx: TenantRequestContext) {
 *     return this.assetService.findAll(ctx);
 *   }
 */
export const TenantCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantRequestContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.tenantContext!;
  },
);

/**
 * @CurrentUserId() — Extracts only the userId string from tenant context.
 *
 * Usage in controller:
 *   @Post('/work-orders')
 *   async create(
 *     @CurrentUserId() userId: string,
 *     @Body() dto: CreateWorkOrderDto,
 *   ) { ... }
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.tenantContext!.userId;
  },
);

/**
 * @CurrentUserRole() — Extracts the role string from tenant context.
 */
export const CurrentUserRole = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.tenantContext!.role;
  },
);

/**
 * @TenantId() — Extracts only the tenantId UUID string.
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.tenantContext!.tenantId;
  },
);

/**
 * @TenantPrisma() — Extracts the tenant-scoped Prisma client directly.
 *
 * Usage in controller (prefer using service layer instead):
 *   async someMethod(@TenantPrisma() prisma: PrismaClient) { ... }
 */
export const TenantPrisma = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.tenantContext!.prisma;
  },
);
