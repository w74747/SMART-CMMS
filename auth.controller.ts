// =============================================================================
// src/app.controller.ts
// Health check + platform info endpoints
// =============================================================================
import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';
import { ConfigService }  from '@nestjs/config';

@ApiTags('System')
@Controller()
export class AppController {
  constructor(
    private readonly prisma:  PrismaService,
    private readonly config:  ConfigService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'API root — returns version info' })
  root() {
    return {
      name:        'Smart CMMS API',
      version:     '1.0.0',
      environment:  this.config.get('NODE_ENV', 'development'),
      docs:        '/api-docs',
    };
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check — verifies DB connectivity' })
  @ApiResponse({ status: 200, description: 'Service is healthy.' })
  @ApiResponse({ status: 503, description: 'Service is degraded.' })
  async health() {
    const dbHealthy = await this.prisma.isHealthy();

    return {
      status:    dbHealthy ? 'ok' : 'degraded',
      database:  dbHealthy ? 'connected' : 'unreachable',
      timestamp: new Date().toISOString(),
      uptime:    process.uptime(),
    };
  }
}
