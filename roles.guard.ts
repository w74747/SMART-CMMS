// =============================================================================
// src/auth/dto/auth.dto.ts
// Data Transfer Objects for all authentication endpoints.
// Validated by class-validator on every incoming request.
// =============================================================================
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsEnum,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Password regex ───────────────────────────────────────────────────────────
// Min 10 chars, 1 uppercase, 1 number, 1 special character
const PASSWORD_REGEX =
  /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{10,}$/;

const PASSWORD_MESSAGE =
  'Password must be at least 10 characters and contain at least one uppercase letter, one number, and one special character.';

// ─── Login ────────────────────────────────────────────────────────────────────

export class LoginDto {
  @ApiProperty({ example: 'ahmed@acme-plant.com' })
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'MySecure@Pass1' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

// ─── Register Tenant (onboarding) ─────────────────────────────────────────────

export enum IndustryType {
  PETROCHEMICAL         = 'PETROCHEMICAL',
  POWER_GENERATION      = 'POWER_GENERATION',
  MINING                = 'MINING',
  WATER_TREATMENT       = 'WATER_TREATMENT',
  FOOD_BEVERAGE         = 'FOOD_BEVERAGE',
  CEMENT                = 'CEMENT',
  STEEL                 = 'STEEL',
  PHARMACEUTICAL        = 'PHARMACEUTICAL',
  GENERAL_MANUFACTURING = 'GENERAL_MANUFACTURING',
  OTHER                 = 'OTHER',
}

export class RegisterTenantDto {
  // ── Company details ────────────────────────────────────────────────────
  @ApiProperty({ example: 'ACME Petrochemical Plant' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  companyName: string;

  @ApiPropertyOptional({ example: 'مصنع أكمي للبتروكيماويات' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  companyNameAr?: string;

  @ApiProperty({ enum: IndustryType, example: IndustryType.PETROCHEMICAL })
  @IsEnum(IndustryType)
  industry: IndustryType;

  @ApiProperty({ example: 'SA' })
  @IsString()
  @IsOptional()
  country?: string = 'SA';

  @ApiProperty({ example: 'Asia/Riyadh' })
  @IsString()
  @IsOptional()
  timezone?: string = 'Asia/Riyadh';

  @ApiProperty({ example: 'contact@acme-plant.com' })
  @IsEmail()
  @IsNotEmpty()
  contactEmail: string;

  @ApiPropertyOptional({ example: '+966501234567' })
  @IsString()
  @IsOptional()
  contactPhone?: string;

  // ── First admin account ────────────────────────────────────────────────
  @ApiProperty({ example: 'Ahmed' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  adminFirstName: string;

  @ApiProperty({ example: 'Al-Rashidi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  adminLastName: string;

  @ApiProperty({ example: 'admin@acme-plant.com' })
  @IsEmail()
  @IsNotEmpty()
  adminEmail: string;

  @ApiProperty({ example: 'Acme@Admin2026!' })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  adminPassword: string;
}

// ─── Refresh Token ────────────────────────────────────────────────────────────

export class RefreshTokenDto {
  @ApiProperty({ description: 'The refresh token from a previous login' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

// ─── Forgot / Reset Password ──────────────────────────────────────────────────

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ahmed@acme-plant.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'Tenant schema name to scope the lookup' })
  @IsString()
  @IsNotEmpty()
  schemaName: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Password reset token from the email link' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'NewSecure@Pass2026!' })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  newPassword: string;

  @ApiProperty({ description: 'Tenant schema name to scope the lookup' })
  @IsString()
  @IsNotEmpty()
  schemaName: string;
}

// ─── Change Password (authenticated) ─────────────────────────────────────────

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldSecure@Pass1' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ example: 'NewSecure@Pass2026!' })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  newPassword: string;
}

// ─── Response shapes ──────────────────────────────────────────────────────────

export class AuthTokensResponse {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  expiresIn: number; // seconds

  @ApiProperty()
  tokenType: 'Bearer';
}

export class LoginResponse {
  @ApiProperty()
  tokens: AuthTokensResponse;

  @ApiProperty()
  user: {
    id:         string;
    email:      string;
    firstName:  string;
    lastName:   string;
    role:       string;
    tenantId:   string;
    schemaName: string;
  };
}
