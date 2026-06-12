// =============================================================================
// src/common/middleware/tenant.middleware.ts
// Smart CMMS — Multi-Tenant Request Context Middleware
//
// RESPONSIBILITY:
//   1. Extract JWT from Authorization header on every incoming request.
//   2. Decode and validate the tenantId + schemaName claims from the token.
//   3. Attach a tenant-scoped PrismaClient instance to the request object,
//      with PostgreSQL search_path set to the tenant's isolated schema.
//   4. Attach raw tenant context (id, schema, role, userId) to req for use
//      by downstream guards, decorators, and service layers.
//
// SECURITY MODEL:
//   - JWT is verified with the same secret as the AuthGuard — middleware does
//     NOT trust unverified tokens; any tampered token throws 401 immediately.
//   - The schemaName is NEVER taken from the request body or URL params —
//     ONLY from the verified JWT claims to prevent tenant-hopping attacks.
//   - search_path is SET at the connection level for each request's DB session,
//     ensuring PostgreSQL-level row isolation even if a query omits tenant_id.
//
// FLOW DIAGRAM:
//   Request
//     │
//     ├── Extract Bearer token from Authorization header
//     ├── Verify JWT signature (HS256) → decode claims
//     ├── Validate: tenantId, schemaName, userId, role present
//     ├── Validate: schemaName matches expected format (tenant_[a-z0-9_]+)
//     ├── Retrieve tenant-scoped Prisma client (cached by schemaName)
//     │     └── On first use: SET search_path = "schemaName", public
//     ├── Attach { tenantId, schemaName, userId, role, prisma } to req
//     └── next() → Controller
// =============================================================================

import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

// ─── Type Extensions ──────────────────────────────────────────────────────────

/**
 * Decoded JWT payload structure for Smart CMMS tokens.
 * All claims are embedded at token issuance time in AuthService.
 */
export interface SmartCmmsJwtPayload {
  sub: string;              // userId (UUID)
  email: string;
  tenantId: string;         // UUID of the tenant in public.tenants
  schemaName: string;       // PostgreSQL schema name: "tenant_abc123"
  role: string;             // UserRole enum value
  permissions?: string[];   // Optional fine-grained permission codes
  iat?: number;
  exp?: number;
}

/**
 * Tenant context attached to every authenticated request.
 * Accessible via @TenantContext() decorator in controllers/services.
 */
export interface TenantRequestContext {
  tenantId: string;
  schemaName: string;
  userId: string;
  userEmail: string;
  role: string;
  permissions: string[];
  /** Tenant-scoped Prisma client with search_path pre-set */
  prisma: PrismaClient;
}

/**
 * Augment Express Request to carry tenant context.
 * Import this in any service/controller to get type-safe access.
 */
declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantRequestContext;
    }
  }
}

// ─── Schema Name Validator ────────────────────────────────────────────────────

/**
 * SECURITY: Allowlist pattern for tenant schema names.
 * Prevents SQL injection via schema name manipulation.
 * Format: "tenant_" followed by lowercase alphanumeric and underscores only.
 * Example valid: "tenant_acme_corp_01"
 * Example invalid: "tenant_'; DROP SCHEMA public;--"
 */
const VALID_SCHEMA_PATTERN = /^tenant_[a-z0-9_]{3,55}$/;

function validateSchemaName(schemaName: string): void {
  if (!VALID_SCHEMA_PATTERN.test(schemaName)) {
    throw new UnauthorizedException(
      `Invalid tenant schema identifier in token. ` +
        `Expected pattern: tenant_[a-z0-9_]{3,55}`,
    );
  }
}

// ─── Tenant-Scoped Prisma Client Cache ───────────────────────────────────────

/**
 * Process-level cache of tenant PrismaClient instances.
 *
 * WHY CACHE PER SCHEMA:
 *   Creating a new PrismaClient per request is expensive (connection pool
 *   initialization). Instead, we create ONE client per tenant schema and
 *   reuse it. The search_path is set at the session level using a middleware
 *   hook on each Prisma query via $use() — ensuring the correct schema is
 *   always active for the connection that executes the query.
 *
 * IMPORTANT: In serverless/edge environments with short-lived processes,
 *   this cache resets on each cold start — which is acceptable behavior.
 */
const tenantPrismaCache = new Map<string, PrismaClient>();

/**
 * Returns a PrismaClient instance whose queries are always executed against
 * the specified tenant schema via PostgreSQL search_path injection.
 *
 * @param schemaName - Validated PostgreSQL schema name (e.g., "tenant_abc")
 * @param databaseUrl - Full PostgreSQL connection string from environment
 */
function getTenantPrismaClient(
  schemaName: string,
  databaseUrl: string,
): PrismaClient {
  if (tenantPrismaCache.has(schemaName)) {
    return tenantPrismaCache.get(schemaName)!;
  }

  const client = new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

  /**
   * Prisma Middleware: SET search_path before EVERY query on this client.
   *
   * WHY THIS APPROACH:
   *   PostgreSQL connection pools may reuse connections across requests.
   *   Setting search_path at the session level ensures the correct schema
   *   is active regardless of which pooled connection is used.
   *
   *   We use $executeRawUnsafe here — the schemaName has already been
   *   validated against VALID_SCHEMA_PATTERN above, making this safe.
   *   The public schema is always appended so PostgreSQL can resolve
   *   built-in functions and the tenants table.
   *
   * PERFORMANCE:
   *   This adds one extra SET statement per query. In production, consider
   *   using PgBouncer with statement-level pooling or connection tagging
   *   to associate connections with tenants and avoid the per-query overhead.
   */
  client.$use(async (params, next) => {
    // Set search_path to tenant schema first, public second.
    // This means: unqualified table names resolve to tenant schema.
    // The "public" fallback allows access to pg_catalog and extensions.
    await client.$executeRawUnsafe(
      `SET search_path TO "${schemaName}", public`,
    );
    return next(params);
  });

  tenantPrismaCache.set(schemaName, client);
  return client;
}

/**
 * Gracefully disconnect all cached Prisma clients on process shutdown.
 * Call this in your main.ts shutdown hook.
 */
export async function disconnectAllTenantClients(): Promise<void> {
  const disconnectPromises = Array.from(tenantPrismaCache.values()).map(
    (client) => client.$disconnect(),
  );
  await Promise.allSettled(disconnectPromises);
  tenantPrismaCache.clear();
}

// ─── Routes Excluded from Tenant Resolution ───────────────────────────────────

/**
 * These routes do NOT require a tenant context because they either:
 *   a) Handle platform-level operations (super admin, health checks), or
 *   b) Handle pre-authentication flows (login, register, refresh token).
 *
 * IMPORTANT: These paths are matched as prefixes. Be conservative — only
 *   exclude routes that genuinely do not touch tenant-specific data.
 */
const EXCLUDED_ROUTE_PREFIXES: string[] = [
  '/health',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
  '/api/v1/auth/verify-email',
  '/api/v1/super-admin',
  '/api/v1/tenants/register',
  '/api-docs',
  '/api/v1/webhooks',
];

function isExcludedRoute(path: string): boolean {
  return EXCLUDED_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// ─── Middleware Implementation ────────────────────────────────────────────────

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // ── Step 1: Check if this route requires tenant resolution ──────────────
    if (isExcludedRoute(req.path)) {
      return next();
    }

    // ── Step 2: Extract Bearer token ───────────────────────────────────────
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Authorization header missing or malformed. Expected: Bearer <token>',
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    if (!token || token.trim() === '') {
      throw new UnauthorizedException('JWT token is empty.');
    }

    // ── Step 3: Verify and decode JWT ──────────────────────────────────────
    let payload: SmartCmmsJwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<SmartCmmsJwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        algorithms: ['HS256'],
      });
    } catch (error: any) {
      this.logger.warn(
        `JWT verification failed from IP ${req.ip}: ${error.message}`,
      );

      if (error.name === 'TokenExpiredError') {
        throw new UnauthorizedException(
          'Access token expired. Please refresh your session.',
        );
      }

      if (error.name === 'JsonWebTokenError') {
        throw new UnauthorizedException(
          'Invalid access token. Authentication failed.',
        );
      }

      throw new UnauthorizedException('Token verification failed.');
    }

    // ── Step 4: Validate required claims are present ────────────────────────
    const { sub, email, tenantId, schemaName, role } = payload;

    if (!sub) {
      throw new UnauthorizedException('JWT is missing subject (sub) claim.');
    }

    if (!tenantId) {
      throw new UnauthorizedException(
        'JWT is missing tenantId claim. Token may be from an incompatible version.',
      );
    }

    if (!schemaName) {
      throw new UnauthorizedException(
        'JWT is missing schemaName claim. Token may be from an incompatible version.',
      );
    }

    if (!role) {
      throw new UnauthorizedException('JWT is missing role claim.');
    }

    // ── Step 5: SECURITY — Validate schema name format ─────────────────────
    // This is the critical security gate: prevents schema injection attacks.
    try {
      validateSchemaName(schemaName);
    } catch {
      // Log at error level — this should never happen in normal operation
      this.logger.error(
        `SECURITY ALERT: Invalid schemaName "${schemaName}" in JWT for ` +
          `userId=${sub}, tenantId=${tenantId}. IP: ${req.ip}. ` +
          `Possible token forgery attempt.`,
      );
      throw new UnauthorizedException('Security validation failed for tenant context.');
    }

    // ── Step 6: Get or create tenant-scoped Prisma client ─────────────────
    const databaseUrl = this.config.getOrThrow<string>('DATABASE_URL');

    let prisma: PrismaClient;
    try {
      prisma = getTenantPrismaClient(schemaName, databaseUrl);
    } catch (error: any) {
      this.logger.error(
        `Failed to initialize Prisma client for schema "${schemaName}": ${error.message}`,
      );
      throw new BadRequestException(
        'Failed to initialize database context for your organization.',
      );
    }

    // ── Step 7: Attach tenant context to request ───────────────────────────
    const tenantContext: TenantRequestContext = {
      tenantId,
      schemaName,
      userId: sub,
      userEmail: email,
      role,
      permissions: payload.permissions ?? [],
      prisma,
    };

    req.tenantContext = tenantContext;

    // ── Step 8: Development logging ────────────────────────────────────────
    if (this.config.get<string>('NODE_ENV') === 'development') {
      this.logger.debug(
        `[${req.method}] ${req.path} | ` +
          `tenant=${schemaName} | user=${sub} | role=${role}`,
      );
    }

    return next();
  }
}
