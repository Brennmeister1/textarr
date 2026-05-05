import type { Config } from '../config/index.js';
import type { Logger } from '../utils/logger.js';
import type { Services } from './index.js';
import { createServices } from './index.js';
import type { SonarrService } from './sonarr.service.js';
import type { RadarrService } from './radarr.service.js';
import type { AIService } from './ai.service.js';
import type { SessionService } from './session.service.js';
import type { TwilioService } from './twilio.service.js';
import type { TMDBService } from './tmdb.service.js';
import type { UserService } from './user.service.js';
import type { MediaRequestService } from './media-request.service.js';
import type { NotificationService } from './notification.service.js';
import type { ProwlarrService } from './prowlarr.service.js';

/**
 * Error thrown when accessing services before initialization
 */
export class ServiceNotInitializedError extends Error {
  constructor(serviceName: string) {
    super(`Service "${serviceName}" is not initialized. Complete configuration first.`);
    this.name = 'ServiceNotInitializedError';
  }
}

/**
 * Result of service initialization attempt
 */
export interface InitializationResult {
  success: boolean;
  errors: string[];
}

/**
 * Result of connection tests
 */
export interface ConnectionTestResult {
  sonarr: boolean;
  radarr: boolean;
  prowlarr: boolean;
}

/**
 * Service container that enables hot-reload of services.
 * Routes access services through getters, allowing services to be
 * reinitialized without restarting the server.
 */
export class ServiceContainer {
  private services: Services | null = null;
  private config: Config | null = null;
  private readonly logger: Logger;
  private initializing = false;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'service-container' });
  }

  /**
   * Check if services are initialized and ready
   */
  get isInitialized(): boolean {
    return this.services !== null;
  }

  /**
   * Get the current runtime configuration
   */
  get currentConfig(): Config | null {
    return this.config;
  }

  /**
   * Get all services (throws if not initialized)
   */
  get all(): Services {
    if (!this.services) {
      throw new ServiceNotInitializedError('services');
    }
    return this.services;
  }

  // Individual service getters
  get sonarr(): SonarrService {
    if (!this.services) {
      throw new ServiceNotInitializedError('sonarr');
    }
    return this.services.sonarr;
  }

  get radarr(): RadarrService {
    if (!this.services) {
      throw new ServiceNotInitializedError('radarr');
    }
    return this.services.radarr;
  }

  get ai(): AIService {
    if (!this.services) {
      throw new ServiceNotInitializedError('ai');
    }
    return this.services.ai;
  }

  get session(): SessionService {
    if (!this.services) {
      throw new ServiceNotInitializedError('session');
    }
    return this.services.session;
  }

  get twilio(): TwilioService {
    if (!this.services) {
      throw new ServiceNotInitializedError('twilio');
    }
    return this.services.twilio;
  }

  get tmdb(): TMDBService {
    if (!this.services) {
      throw new ServiceNotInitializedError('tmdb');
    }
    return this.services.tmdb;
  }

  get user(): UserService {
    if (!this.services) {
      throw new ServiceNotInitializedError('user');
    }
    return this.services.user;
  }

  get mediaRequest(): MediaRequestService {
    if (!this.services) {
      throw new ServiceNotInitializedError('mediaRequest');
    }
    return this.services.mediaRequest;
  }

  get notification(): NotificationService {
    if (!this.services) {
      throw new ServiceNotInitializedError('notification');
    }
    return this.services.notification;
  }

  get prowlarr(): ProwlarrService {
    if (!this.services) {
      throw new ServiceNotInitializedError('prowlarr');
    }
    return this.services.prowlarr;
  }

  /**
   * Get services or null if not initialized (for safe access in webhooks)
   */
  getServices(): Services | null {
    return this.services;
  }

  /**
   * Set notification service dependencies (called after services are created)
   */
  initializeNotificationDependencies(): void {
    if (this.services) {
      this.services.notification.setDependencies({
        userService: this.services.user,
        twilioService: this.services.twilio,
      });
      this.logger.debug('Notification service dependencies set');
    }
  }

  /**
   * Initialize or reinitialize services with new configuration.
   * If services already exist, they are cleaned up first.
   */
  async initialize(config: Config): Promise<InitializationResult> {
    if (this.initializing) {
      return {
        success: false,
        errors: ['Initialization already in progress'],
      };
    }

    this.initializing = true;
    const errors: string[] = [];

    try {
      this.logger.info('Initializing services...');

      // Clean up existing services if any
      await this.cleanup();

      // Create new services
      const newServices = createServices(config, this.logger);

      // Store the new services and config
      this.services = newServices;
      this.config = config;

      // Initialize notification service dependencies
      this.initializeNotificationDependencies();

      this.logger.info('Services initialized successfully');
      return { success: true, errors: [] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(errorMessage);
      this.logger.error({ error: errorMessage }, 'Failed to initialize services');

      // Note: We don't restore old services on failure - they were already cleaned up
      // This is intentional to avoid using stale services with new config
      return { success: false, errors };
    } finally {
      this.initializing = false;
    }
  }

  /**
   * Clean up current services (stop intervals, close connections)
   */
  async cleanup(): Promise<void> {
    if (this.services) {
      this.logger.info('Cleaning up existing services...');

      // Stop the session cleanup interval
      this.services.session.stop();

      // Clear references
      this.services = null;
      this.config = null;

      this.logger.info('Services cleaned up');
    }
  }

  /**
   * Test connections to external services
   */
  async testConnections(): Promise<ConnectionTestResult> {
    if (!this.services) {
      return { sonarr: false, radarr: false, prowlarr: false };
    }

    const [sonarr, radarr, prowlarr] = await Promise.all([
      this.services.sonarr.testConnection(),
      this.services.radarr.testConnection(),
      this.services.prowlarr.testConnection(),
    ]);

    return { sonarr, radarr, prowlarr };
  }
}
