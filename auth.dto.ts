// =============================================================================
// src/auth/auth.controller.ts
// Smart CMMS — Authentication REST Controller
// Base path: /api/v1/auth
// =============================================================================
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Headers,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiHeader,
} from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { Throttle } from '@nestjs/throttler';

import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterTenantDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { TenantCtx } from '../common/decorators/tenant-context.decorator';
import { TenantRequestContext } from '../common/middleware/tenant.middleware';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ===========================================================================
  // POST /auth/register
  // ===========================================================================

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 3, ttl: 60000 } }) // Max 3 registrations/minute per IP
  @ApiOperation({
    summary: 'Register a new company (tenant)',
    description:
      'Creates a new isolated company workspace on the platform. ' +
      'Provisions a dedicated PostgreSQL schema and creates the first Company Admin account. ' +
      'Returns access + refresh tokens for immediate auto-login.',
  })
  @ApiBody({ type: RegisterTenantDto })
  @ApiResponse({
    status: 201,
    description: 'Company registered successfully. Returns auth tokens + user profile.',
  })
  @ApiResponse({ status: 400, description: 'Validation error or provisioning failure.' })
  @ApiResponse({ status: 409, description: 'Email address already registered.' })
  async register(
    @Body() dto: RegisterTenantDto,
    @Ip() ipAddress: string,
  ) {
    return this.authService.registerTenant(dto, ipAddress);
  }

  // ===========================================================================
  // POST /auth/login
  // ===========================================================================

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // Max 10 attempts/minute per IP
  @ApiOperation({
    summary: 'Login to a specific company workspace',
    description:
      'Authenticates a user against a specific tenant schema. ' +
      'The X-Schema-Name header MUST match the company schema (returned on first login and stored client-side). ' +
      'Implements brute-force protection: account locks after 5 consecutive failures.',
  })
  @ApiHeader({
    name: 'X-Schema-Name',
    description: "Tenant's PostgreSQL schema name (e.g., tenant_acme_plant_a1b2c3d4)",
    required: true,
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Login successful. Returns tokens + user.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  @ApiResponse({ status: 403, description: 'Account locked or deactivated.' })
  async login(
    @Body() dto: LoginDto,
    @Headers('x-schema-name') schemaName: string,
    @Ip() ipAddress: string,
  ) {
    return this.authService.login(dto, schemaName, ipAddress);
  }

  // ===========================================================================
  // POST /auth/refresh
  // ===========================================================================

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Exchanges a valid refresh token for a new access + refresh token pair. ' +
      'The old refresh token is immediately revoked (token rotation). ' +
      'Replaying a used refresh token triggers a full session invalidation.',
  })
  @ApiHeader({
    name: 'X-Schema-Name',
    description: 'Tenant schema name',
    required: true,
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 200, description: 'New token pair issued.' })
  @ApiResponse({ status: 401, description: 'Refresh token invalid, expired, or replayed.' })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Headers('x-schema-name') schemaName: string,
    @Ip() ipAddress: string,
  ) {
    return this.authService.refreshTokens(dto.refreshToken, schemaName, ipAddress);
  }

  // ===========================================================================
  // POST /auth/logout
  // ===========================================================================

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Logout — revoke refresh token',
    description:
      'Revokes the provided refresh token, preventing its future use. ' +
      'The access token will expire naturally (15-minute TTL).',
  })
  @ApiHeader({
    name: 'X-Schema-Name',
    description: 'Tenant schema name',
    required: true,
  })
  async logout(
    @Body() dto: RefreshTokenDto,
    @Headers('x-schema-name') schemaName: string,
  ): Promise<void> {
    await this.authService.logout(dto.refreshToken, schemaName);
  }

  // ===========================================================================
  // POST /auth/forgot-password
  // ===========================================================================

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 300000 } }) // Max 3 per 5 minutes
  @ApiOperation({
    summary: 'Request a password reset email',
    description:
      'Sends a password reset link to the user email if found. ' +
      'Always returns 200 regardless of whether the email exists (prevents enumeration).',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({ status: 200, description: 'Reset email sent if account exists.' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.initiatePasswordReset(dto.email, dto.schemaName);
    return { message: 'If this email is registered, a reset link has been sent.' };
  }

  // ===========================================================================
  // POST /auth/reset-password
  // ===========================================================================

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  @ApiOperation({
    summary: 'Reset password using token from email',
    description:
      'Validates the reset token (valid for 1 hour) and sets the new password. ' +
      'All existing sessions are invalidated on successful reset.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 200, description: 'Password reset successfully.' })
  @ApiResponse({ status: 400, description: 'Token invalid or expired.' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword, dto.schemaName);
    return { message: 'Password reset successfully. Please log in with your new password.' };
  }

  // ===========================================================================
  // GET /auth/me  (protected)
  // ===========================================================================

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current authenticated user profile',
    description: 'Returns the decoded JWT context + tenant info for the current session.',
  })
  @ApiResponse({ status: 200, description: 'Current user profile.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  getMe(@TenantCtx() ctx: TenantRequestContext) {
    return {
      userId:     ctx.userId,
      email:      ctx.userEmail,
      role:       ctx.role,
      tenantId:   ctx.tenantId,
      schemaName: ctx.schemaName,
      permissions: ctx.permissions,
    };
  }

  // ===========================================================================
  // GET /auth/find-company  (public — for login screen)
  // ===========================================================================

  @Post('find-company')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Resolve company schema from contact email',
    description:
      'Allows the login screen to find a company schema name from the registered contact email. ' +
      'Used when the user forgot their company identifier.',
  })
  @ApiResponse({ status: 200, description: 'Company found — returns schema and name.' })
  @ApiResponse({ status: 404, description: 'No company found for this email.' })
  async findCompany(@Body() body: { email: string }) {
    const tenant = await this.authService.findTenantByEmail(body.email);
    if (!tenant) {
      return { found: false, message: 'No company found for this email address.' };
    }
    return {
      found:       true,
      schemaName:  tenant.schemaName,
      companyName: tenant.companyName,
    };
  }
}
