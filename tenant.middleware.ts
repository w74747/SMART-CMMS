// =============================================================================
// src/common/config/env.validation.ts
// Validates all required environment variables at application startup.
// If any required var is missing the app refuses to start — fail-fast.
// =============================================================================
import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production  = 'production',
  Test        = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(1)
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  DIRECT_URL: string;

  @IsUrl({ require_tld: false })
  SUPABASE_URL: string;

  @IsString()
  SUPABASE_ANON_KEY: string;

  @IsString()
  SUPABASE_SERVICE_ROLE_KEY: string;

  @IsString()
  SUPABASE_BUCKET_ASSETS: string;

  @IsString()
  SUPABASE_BUCKET_WORK_ORDERS: string;

  @IsString()
  SUPABASE_BUCKET_IMPORTS: string;

  @IsString()
  SUPABASE_BUCKET_EXPORTS: string;

  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_REFRESH_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  @IsString()
  @IsOptional()
  REDIS_URL: string;

  @IsString()
  @IsOptional()
  SMTP_HOST: string;

  @IsString()
  @IsOptional()
  EMAIL_FROM_ADDRESS: string = 'noreply@smart-cmms.com';

  @IsString()
  @IsOptional()
  EMAIL_FROM_NAME: string = 'Smart CMMS';

  @IsString()
  @IsOptional()
  FRONTEND_URL: string = 'http://localhost:3001';

  @IsString()
  @IsOptional()
  ALLOWED_ORIGINS: string = 'http://localhost:3001';

  @IsString()
  @IsOptional()
  QR_CODE_BASE_URL: string = 'http://localhost:3001/assets/qr';
}

export function validateEnv(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }

  return validatedConfig;
}
