// =============================================================================
// src/auth/auth.module.ts
// =============================================================================
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthService }    from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaModule }   from '../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Default secret used for access tokens.
        // Refresh tokens use a DIFFERENT secret configured directly in AuthService.
        secret:      config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.get('JWT_ACCESS_EXPIRES_IN', '15m') },
      }),
    }),
  ],
  providers:   [AuthService],
  controllers: [AuthController],
  exports:     [AuthService, JwtModule],
})
export class AuthModule {}
