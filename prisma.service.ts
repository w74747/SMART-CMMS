// =============================================================================
// src/common/filters/http-exception.filter.ts
// Unified error response format across all endpoints.
// Every exception — NestJS built-in or custom — returns the same JSON shape.
// =============================================================================
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  requestId?: string;
}

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request  = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const res  = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        message = (resObj.message as string | string[]) ?? exception.message;
        error   = (resObj.error as string) ?? exception.name;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      // Log full stack for unexpected errors
      this.logger.error(
        `Unhandled exception on [${request.method}] ${request.path}`,
        exception.stack,
      );
    }

    // Log 5xx errors
    if (statusCode >= 500) {
      this.logger.error(
        `[${statusCode}] ${request.method} ${request.path} — ${message}`,
      );
    } else if (statusCode >= 400) {
      this.logger.warn(
        `[${statusCode}] ${request.method} ${request.path} — ${message}`,
      );
    }

    const body: ApiErrorResponse = {
      success:    false,
      statusCode,
      error,
      message,
      path:       request.path,
      timestamp:  new Date().toISOString(),
      requestId:  request.headers['x-request-id'] as string | undefined,
    };

    response.status(statusCode).json(body);
  }
}
