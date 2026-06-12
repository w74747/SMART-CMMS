// =============================================================================
// src/auth/auth.service.ts
// Smart CMMS — Core Authentication Service
//
// Responsibilities:
//   - Tenant registration + schema provisioning
//   - Login with brute-force protection
//   - JWT access + refresh token issuance and rotation
//   - Password reset flow (token-based, email-driven)
//   - Token revocation on logout
// =============================================================================
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { SmartCmmsJwtPayload } from '../common/middleware/tenant.middleware';
import {
  LoginDto,
  RegisterTenantDto,
  LoginResponse,
  AuthTokensResponse,
} from './dto/auth.dto';

// ─── Constants ────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS       = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS    = 30 * 60 * 1000;  // 30 minutes
const RESET_TOKEN_EXPIRY  = 60 * 60 * 1000;  // 1 hour
const SCHEMA_NAME_REGEX   = /^tenant_[a-z0-9_]{3,55}$/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Converts a company name to a safe PostgreSQL schema name */
function buildSchemaName(companyName: string, suffix: string): string {
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')   // replace non-alphanumeric with underscore
    .replace(/_+/g, '_')          // collapse consecutive underscores
    .replace(/^_|_$/g, '')        // trim leading/trailing underscores
    .slice(0, 30);                // cap at 30 chars

  const schemaName = `tenant_${slug}_${suffix}`;

  if (!SCHEMA_NAME_REGEX.test(schemaName)) {
    // Fallback to pure UUID-based name if slug is problematic
    return `tenant_${suffix}`;
  }

  return schemaName;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,       // public schema client
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ===========================================================================
  // TENANT REGISTRATION
  // ===========================================================================

  /**
   * Registers a new company (tenant) on the platform.
   *
   * Steps:
   *   1. Check email uniqueness across all tenants (via public.tenants contact_email)
   *   2. Generate unique schema name
   *   3. Create tenant record in public.tenants
   *   4. Provision isolated PostgreSQL schema via fn_provision_tenant_schema()
   *   5. Create first Company Admin user in the new tenant schema
   *   6. Return access + refresh tokens immediately (auto-login after signup)
   */
  async registerTenant(dto: RegisterTenantDto, ipAddress?: string): Promise<LoginResponse> {
    // ── Step 1: Check contact email not already registered ─────────────────
    const existingTenant = await this.prisma.tenant.findFirst({
      where: { contactEmail: dto.contactEmail },
    });

    if (existingTenant) {
      throw new ConflictException(
        'This email address is already associated with a registered company.',
      );
    }

    // ── Step 2: Generate unique schema name ────────────────────────────────
    const shortUuid = uuidv4().replace(/-/g, '').slice(0, 8);
    const schemaName = buildSchemaName(dto.companyName, shortUuid);

    this.logger.log(`Registering new tenant: "${dto.companyName}" → schema: "${schemaName}"`);

    // ── Step 3: Create tenant record in public schema ──────────────────────
    let tenant: { id: string; schemaName: string };
    try {
      tenant = await this.prisma.tenant.create({
        data: {
          schemaName,
          companyName:    dto.companyName,
          companyNameAr:  dto.companyNameAr,
          industry:       dto.industry as any,
          contactEmail:   dto.contactEmail,
          contactPhone:   dto.contactPhone,
          country:        dto.country ?? 'SA',
          timezone:       dto.timezone ?? 'Asia/Riyadh',
          subscriptionTier:   'STARTER' as any,
          subscriptionStatus: 'TRIAL' as any,
          trialEndsAt:    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30-day trial
          maxUsers:       20,
          maxAssets:      500,
        },
        select: { id: true, schemaName: true },
      });
    } catch (err: any) {
      this.logger.error(`Failed to create tenant record: ${err.message}`);
      throw new BadRequestException('Failed to register company. Please try again.');
    }

    // ── Step 4: Provision isolated PostgreSQL schema ───────────────────────
    try {
      await this.prisma.$executeRawUnsafe(
        `SELECT public.fn_provision_tenant_schema($1)`,
        schemaName,
      );
      this.logger.log(`Schema provisioned: ${schemaName}`);
    } catch (err: any) {
      // Rollback: delete the tenant record if schema provisioning fails
      await this.prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
      this.logger.error(`Schema provisioning failed: ${err.message}`);
      throw new BadRequestException(
        'Failed to initialize company workspace. Please contact support.',
      );
    }

    // ── Step 5: Create Company Admin user in tenant schema ─────────────────
    // We create a tenant-scoped Prisma client pointed at the new schema
    const tenantPrisma = new PrismaClient({
      datasources: { db: { url: this.config.getOrThrow('DATABASE_URL') } },
    });

    let adminUser: { id: string; email: string; firstName: string; lastName: string; role: string };

    try {
      await tenantPrisma.$executeRawUnsafe(
        `SET search_path TO "${schemaName}", public`,
      );

      const passwordHash = await bcrypt.hash(dto.adminPassword, BCRYPT_ROUNDS);

      adminUser = await (tenantPrisma as any).user.create({
        data: {
          email:        dto.adminEmail,
          passwordHash,
          firstName:    dto.adminFirstName,
          lastName:     dto.adminLastName,
          role:         'COMPANY_ADMIN',
          isActive:     true,
          isEmailVerified: false, // Email verification sent separately
        },
        select: { id: true, email: true, firstName: true, lastName: true, role: true },
      });

      this.logger.log(
        `Company Admin created: ${adminUser.email} in schema ${schemaName}`,
      );
    } catch (err: any) {
      this.logger.error(`Failed to create admin user: ${err.message}`);
      // Attempt cleanup
      await this.prisma.$executeRawUnsafe(
        `SELECT public.fn_deprovision_tenant_schema($1, $2)`,
        schemaName,
        `I CONFIRM DELETION OF ${schemaName}`,
      ).catch(() => {});
      await this.prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
      throw new BadRequestException('Failed to create administrator account.');
    } finally {
      await tenantPrisma.$disconnect();
    }

    // ── Step 6: Issue tokens (auto-login) ─────────────────────────────────
    const tokens = await this.issueTokens(
      {
        sub:        adminUser.id,
        email:      adminUser.email,
        tenantId:   tenant.id,
        schemaName: tenant.schemaName,
        role:       adminUser.role,
        permissions: [],
      },
      adminUser.id,
      schemaName,
      ipAddress,
    );

    this.logger.log(`Tenant registration complete: ${dto.companyName} (${schemaName})`);

    return {
      tokens,
      user: {
        id:         adminUser.id,
        email:      adminUser.email,
        firstName:  adminUser.firstName,
        lastName:   adminUser.lastName,
        role:       adminUser.role,
        tenantId:   tenant.id,
        schemaName: tenant.schemaName,
      },
    };
  }

  // ===========================================================================
  // LOGIN
  // ===========================================================================

  /**
   * Authenticates a user against a specific tenant schema.
   *
   * The schemaName MUST be provided by the client (e.g., stored in localStorage
   * after first login, or resolved via a company-lookup endpoint).
   * This enforces schema-level isolation: a user in "tenant_abc" cannot
   * accidentally authenticate against "tenant_xyz".
   */
  async login(
    dto: LoginDto,
    schemaName: string,
    ipAddress?: string,
  ): Promise<LoginResponse> {
    // ── Validate schema name format ────────────────────────────────────────
    if (!SCHEMA_NAME_REGEX.test(schemaName)) {
      throw new UnauthorizedException('Invalid company identifier.');
    }

    // ── Verify schema exists in the tenant registry ────────────────────────
    const tenant = await this.prisma.tenant.findUnique({
      where: { schemaName },
      select: { id: true, schemaName: true, isActive: true, subscriptionStatus: true },
    });

    if (!tenant) {
      throw new UnauthorizedException('Company not found. Check your company identifier.');
    }

    if (!tenant.isActive) {
      throw new ForbiddenException(
        'This company account has been suspended. Please contact support.',
      );
    }

    // ── Connect to tenant schema and find user ─────────────────────────────
    const tenantPrisma = new PrismaClient({
      datasources: { db: { url: this.config.getOrThrow('DATABASE_URL') } },
    });

    try {
      await tenantPrisma.$executeRawUnsafe(
        `SET search_path TO "${schemaName}", public`,
      );

      const user = await (tenantPrisma as any).user.findUnique({
        where: { email: dto.email.toLowerCase().trim() },
        select: {
          id:              true,
          email:           true,
          firstName:       true,
          lastName:        true,
          passwordHash:    true,
          role:            true,
          isActive:        true,
          failedLoginCount: true,
          lockedUntil:     true,
        },
      });

      // ── User not found — use generic message to prevent email enumeration ──
      if (!user) {
        throw new UnauthorizedException('Invalid email or password.');
      }

      // ── Account active check ───────────────────────────────────────────────
      if (!user.isActive) {
        throw new ForbiddenException(
          'Your account has been deactivated. Contact your administrator.',
        );
      }

      // ── Brute-force lockout check ──────────────────────────────────────────
      if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
        const remainingMs = new Date(user.lockedUntil).getTime() - Date.now();
        const remainingMin = Math.ceil(remainingMs / 60000);
        throw new ForbiddenException(
          `Account temporarily locked due to too many failed attempts. ` +
            `Try again in ${remainingMin} minute(s).`,
        );
      }

      // ── Password verification ──────────────────────────────────────────────
      const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);

      if (!passwordValid) {
        // Increment failed attempt counter
        const newCount = (user.failedLoginCount ?? 0) + 1;
        const updateData: Record<string, unknown> = { failedLoginCount: newCount };

        if (newCount >= MAX_FAILED_ATTEMPTS) {
          updateData.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
          this.logger.warn(
            `Account locked after ${newCount} failed attempts: ${user.email} in ${schemaName}`,
          );
        }

        await (tenantPrisma as any).user.update({
          where: { id: user.id },
          data:  updateData,
        });

        throw new UnauthorizedException('Invalid email or password.');
      }

      // ── Success: reset failed counter, record last login ───────────────────
      await (tenantPrisma as any).user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil:      null,
          lastLoginAt:      new Date(),
          lastLoginIp:      ipAddress,
        },
      });

      // ── Issue tokens ───────────────────────────────────────────────────────
      const tokens = await this.issueTokens(
        {
          sub:         user.id,
          email:       user.email,
          tenantId:    tenant.id,
          schemaName:  tenant.schemaName,
          role:        user.role,
          permissions: [],
        },
        user.id,
        schemaName,
        ipAddress,
        tenantPrisma,
      );

      return {
        tokens,
        user: {
          id:         user.id,
          email:      user.email,
          firstName:  user.firstName,
          lastName:   user.lastName,
          role:       user.role,
          tenantId:   tenant.id,
          schemaName: tenant.schemaName,
        },
      };
    } finally {
      await tenantPrisma.$disconnect();
    }
  }

  // ===========================================================================
  // TOKEN REFRESH
  // ===========================================================================

  /**
   * Validates a refresh token, rotates it, and issues new access + refresh tokens.
   * Refresh token rotation: old token is revoked on use; a new one is issued.
   * This allows detection of token theft: replaying an old refresh token
   * will fail because it was already revoked.
   */
  async refreshTokens(
    refreshToken: string,
    schemaName: string,
    ipAddress?: string,
  ): Promise<AuthTokensResponse> {
    if (!SCHEMA_NAME_REGEX.test(schemaName)) {
      throw new UnauthorizedException('Invalid company identifier.');
    }

    // ── Verify JWT signature first ─────────────────────────────────────────
    let payload: SmartCmmsJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<SmartCmmsJwtPayload>(
        refreshToken,
        { secret: this.config.getOrThrow('JWT_REFRESH_SECRET') },
      );
    } catch {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }

    // ── Look up the token in the database ─────────────────────────────────
    const tokenHash = this.hashToken(refreshToken);

    const tenantPrisma = new PrismaClient({
      datasources: { db: { url: this.config.getOrThrow('DATABASE_URL') } },
    });

    try {
      await tenantPrisma.$executeRawUnsafe(
        `SET search_path TO "${schemaName}", public`,
      );

      const stored = await (tenantPrisma as any).refreshToken.findUnique({
        where: { tokenHash },
        select: {
          id:        true,
          userId:    true,
          expiresAt: true,
          revokedAt: true,
        },
      });

      if (!stored) {
        throw new UnauthorizedException('Refresh token not recognised. Please log in again.');
      }

      if (stored.revokedAt) {
        // Token replay detected — revoke ALL tokens for this user (security incident)
        this.logger.error(
          `SECURITY: Refresh token replay detected for user ${stored.userId} in ${schemaName}. ` +
            `Revoking all sessions.`,
        );
        await (tenantPrisma as any).refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data:  { revokedAt: new Date() },
        });
        throw new UnauthorizedException(
          'Security alert: Your session has been invalidated. Please log in again.',
        );
      }

      if (new Date(stored.expiresAt) < new Date()) {
        throw new UnauthorizedException('Refresh token has expired. Please log in again.');
      }

      // ── Revoke old token ───────────────────────────────────────────────────
      await (tenantPrisma as any).refreshToken.update({
        where: { id: stored.id },
        data:  { revokedAt: new Date() },
      });

      // ── Get tenant info for new token payload ──────────────────────────────
      const tenant = await this.prisma.tenant.findUnique({
        where:  { schemaName },
        select: { id: true },
      });

      if (!tenant) throw new UnauthorizedException('Tenant not found.');

      // ── Issue fresh token pair ─────────────────────────────────────────────
      return this.issueTokens(
        {
          sub:         payload.sub,
          email:       payload.email,
          tenantId:    tenant.id,
          schemaName,
          role:        payload.role,
          permissions: payload.permissions ?? [],
        },
        stored.userId,
        schemaName,
        ipAddress,
        tenantPrisma,
      );
    } finally {
      await tenantPrisma.$disconnect();
    }
  }

  // ===========================================================================
  // LOGOUT
  // ===========================================================================

  async logout(refreshToken: string, schemaName: string): Promise<void> {
    if (!SCHEMA_NAME_REGEX.test(schemaName)) return;

    const tokenHash = this.hashToken(refreshToken);
    const tenantPrisma = new PrismaClient({
      datasources: { db: { url: this.config.getOrThrow('DATABASE_URL') } },
    });

    try {
      await tenantPrisma.$executeRawUnsafe(
        `SET search_path TO "${schemaName}", public`,
      );

      await (tenantPrisma as any).refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data:  { revokedAt: new Date() },
      });
    } catch (err: any) {
      this.logger.warn(`Logout token revocation failed: ${err.message}`);
    } finally {
      await tenantPrisma.$disconnect();
    }
  }

  // ===========================================================================
  // COMPANY LOOKUP (for login screen — resolve schema from email domain or slug)
  // ===========================================================================

  /**
   * Finds a tenant by contact email — used by the login screen's
   * "Find my company" flow so users don't need to remember their schema name.
   */
  async findTenantByEmail(contactEmail: string): Promise<{
    schemaName: string;
    companyName: string;
  } | null> {
    const tenant = await this.prisma.tenant.findFirst({
      where: {
        contactEmail: contactEmail.toLowerCase(),
        isActive:     true,
      },
      select: { schemaName: true, companyName: true },
    });

    return tenant;
  }

  // ===========================================================================
  // PASSWORD RESET
  // ===========================================================================

  /**
   * Initiates a password reset: generates a secure token, stores its hash,
   * and triggers an email. Returns void regardless of whether email exists
   * to prevent user enumeration.
   */
  async initiatePasswordReset(email: string, schemaName: string): Promise<void> {
    if (!SCHEMA_NAME_REGEX.test(schemaName)) return;

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash  = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt  = new Date(Date.now() + RESET_TOKEN_EXPIRY);

    const tenantPrisma = new PrismaClient({
      datasources: { db: { url: this.config.getOrThrow('DATABASE_URL') } },
    });

    try {
      await tenantPrisma.$executeRawUnsafe(
        `SET search_path TO "${schemaName}", public`,
      );

      const user = await (tenantPrisma as any).user.findUnique({
        where:  { email: email.toLowerCase() },
        select: { id: true, email: true, firstName: true },
      });

      if (!user) {
        // Return silently — don't reveal whether email exists
        return;
      }

      // Store the token hash in user metadata
      await (tenantPrisma as any).user.update({
        where: { id: user.id },
        data: {
          metadata: {
            passwordResetTokenHash: tokenHash,
            passwordResetExpiresAt: expiresAt.toISOString(),
          },
        },
      });

      // TODO: Inject MailService and send reset email
      // The reset link: ${FRONTEND_URL}/reset-password?token=${resetToken}&schema=${schemaName}
      this.logger.log(
        `Password reset initiated for ${email} in ${schemaName}. Token: ${resetToken}`,
      );
    } finally {
      await tenantPrisma.$disconnect();
    }
  }

  /**
   * Verifies the reset token and sets the new password.
   */
  async resetPassword(
    token: string,
    newPassword: string,
    schemaName: string,
  ): Promise<void> {
    if (!SCHEMA_NAME_REGEX.test(schemaName)) {
      throw new BadRequestException('Invalid company identifier.');
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const tenantPrisma = new PrismaClient({
      datasources: { db: { url: this.config.getOrThrow('DATABASE_URL') } },
    });

    try {
      await tenantPrisma.$executeRawUnsafe(
        `SET search_path TO "${schemaName}", public`,
      );

      // Find user with matching reset token hash
      const users: any[] = await tenantPrisma.$queryRawUnsafe(`
        SELECT id, metadata
        FROM users
        WHERE metadata->>'passwordResetTokenHash' = $1
          AND (metadata->>'passwordResetExpiresAt')::timestamptz > NOW()
          AND deleted_at IS NULL
        LIMIT 1
      `, tokenHash);

      if (!users.length) {
        throw new BadRequestException(
          'Password reset link is invalid or has expired.',
        );
      }

      const user = users[0];
      const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

      await (tenantPrisma as any).user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginCount:  0,
          lockedUntil:       null,
          metadata:          {}, // Clear reset token
        },
      });

      // Revoke all existing refresh tokens for this user
      await (tenantPrisma as any).refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data:  { revokedAt: new Date() },
      });

      this.logger.log(`Password reset successful for user ${user.id} in ${schemaName}`);
    } finally {
      await tenantPrisma.$disconnect();
    }
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Issues a new access token + refresh token pair.
   * Stores the refresh token hash in the tenant's database.
   *
   * @param claims       - JWT payload claims
   * @param userId       - User UUID (for refresh token storage)
   * @param schemaName   - Tenant schema (for refresh token storage)
   * @param ipAddress    - Client IP (for audit)
   * @param tenantPrisma - Optional: reuse an already-open tenant PrismaClient
   */
  private async issueTokens(
    claims: SmartCmmsJwtPayload,
    userId: string,
    schemaName: string,
    ipAddress?: string,
    tenantPrisma?: PrismaClient,
  ): Promise<AuthTokensResponse> {
    const accessExpiresIn  = this.config.get('JWT_ACCESS_EXPIRES_IN', '15m');
    const refreshExpiresIn = this.config.get('JWT_REFRESH_EXPIRES_IN', '7d');

    // ── Sign access token ──────────────────────────────────────────────────
    const accessToken = await this.jwtService.signAsync(claims, {
      secret:    this.config.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: accessExpiresIn,
    });

    // ── Sign refresh token (includes only minimal claims) ──────────────────
    const refreshClaims: SmartCmmsJwtPayload = {
      sub:        claims.sub,
      email:      claims.email,
      tenantId:   claims.tenantId,
      schemaName: claims.schemaName,
      role:       claims.role,
    };

    const refreshToken = await this.jwtService.signAsync(refreshClaims, {
      secret:    this.config.getOrThrow('JWT_REFRESH_SECRET'),
      expiresIn: refreshExpiresIn,
    });

    // ── Store refresh token hash in DB ─────────────────────────────────────
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(
      Date.now() + this.parseDurationMs(refreshExpiresIn),
    );

    const ownPrisma = !tenantPrisma;
    const client    = tenantPrisma ?? new PrismaClient({
      datasources: { db: { url: this.config.getOrThrow('DATABASE_URL') } },
    });

    try {
      if (ownPrisma) {
        await client.$executeRawUnsafe(
          `SET search_path TO "${schemaName}", public`,
        );
      }

      await (client as any).refreshToken.create({
        data: {
          tokenHash,
          userId,
          ipAddress,
          expiresAt,
        },
      });
    } finally {
      if (ownPrisma) await client.$disconnect();
    }

    // Parse access token expiry to seconds for the response
    const expiresInSeconds = this.parseDurationMs(accessExpiresIn) / 1000;

    return {
      accessToken,
      expiresIn: expiresInSeconds,
      tokenType: 'Bearer',
    };
  }

  /** SHA-256 hash of token for safe database storage */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /** Convert duration string ('15m', '7d') to milliseconds */
  private parseDurationMs(duration: string): number {
    const num  = parseInt(duration, 10);
    const unit = duration.slice(-1);
    const map: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return num * (map[unit] ?? 60_000);
  }
}
