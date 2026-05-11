/**
 * Base error class for application errors
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error for unauthorized access
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

/**
 * Error for invalid requests
 */
export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(message, 400);
  }
}

/**
 * Error for media service API failures (Sonarr/Radarr)
 */
export class MediaServiceError extends AppError {
  public readonly service: 'sonarr' | 'radarr' | 'prowlarr';

  constructor(service: 'sonarr' | 'radarr' | 'prowlarr', message: string, statusCode = 500) {
    super(`${service.charAt(0).toUpperCase() + service.slice(1)}: ${message}`, statusCode);
    this.service = service;
  }
}

// Backwards-compatible aliases
export const SonarrError = class extends MediaServiceError {
  constructor(message: string, statusCode = 500) {
    super('sonarr', message, statusCode);
  }
};

export const RadarrError = class extends MediaServiceError {
  constructor(message: string, statusCode = 500) {
    super('radarr', message, statusCode);
  }
};

/**
 * Error for AI parsing failures
 */
export class AIParseError extends AppError {
  constructor(message: string) {
    super(`AI Parse: ${message}`, 500);
  }
}

/**
 * Error for AI provider quota/rate limit exhaustion.
 */
export class AIQuotaError extends AppError {
  constructor(message = 'AI provider quota or rate limit exceeded') {
    super(`AI Quota: ${message}`, 429);
  }
}

/**
 * Error for Twilio failures
 */
export class TwilioError extends AppError {
  constructor(message: string) {
    super(`Twilio: ${message}`, 500);
  }
}
