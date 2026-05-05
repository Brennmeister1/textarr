import type { Config } from '../config/index.js';
import type { Logger } from '../utils/logger.js';
import { SonarrService } from './sonarr.service.js';
import { RadarrService } from './radarr.service.js';
import { AIService } from './ai.service.js';
import { SessionService } from './session.service.js';
import { TwilioService } from './twilio.service.js';
import { TMDBService } from './tmdb.service.js';
import { UserService } from './user.service.js';
import { MediaRequestService } from './media-request.service.js';
import { NotificationService } from './notification.service.js';
import { ProwlarrService } from './prowlarr.service.js';

export { BaseMediaService, type BaseMediaConfig, type QueueItem } from './base-media.service.js';
export { SonarrService, type SonarrConfig } from './sonarr.service.js';
export { RadarrService, type RadarrConfig } from './radarr.service.js';
export { AIService, type AIConfig } from './ai.service.js';
export { SessionService } from './session.service.js';
export { TwilioService, type TwilioConfig } from './twilio.service.js';
export { TMDBService, type TMDBConfig } from './tmdb.service.js';
export { UserService, type QuotaCheckResult, type QuotaConfig } from './user.service.js';
export { MediaRequestService } from './media-request.service.js';
export { NotificationService, type DownloadNotificationConfig } from './notification.service.js';
export { ProwlarrService, type ProwlarrConfig, type ProwlarrSearchResult, type FilteredProwlarrResult, PROWLARR_CATEGORIES, type ProwlarrMediaType } from './prowlarr.service.js';
export {
  ServiceContainer,
  ServiceNotInitializedError,
  type InitializationResult,
  type ConnectionTestResult,
} from './container.js';

/**
 * All application services
 */
export interface Services {
  sonarr: SonarrService;
  radarr: RadarrService;
  prowlarr: ProwlarrService;
  ai: AIService;
  session: SessionService;
  twilio: TwilioService;
  tmdb: TMDBService;
  user: UserService;
  mediaRequest: MediaRequestService;
  notification: NotificationService;
}

/**
 * Create all services from config
 */
export function createServices(config: Config, logger: Logger): Services {
  return {
    sonarr: new SonarrService(config.sonarr, logger),
    radarr: new RadarrService(config.radarr, logger),
    prowlarr: new ProwlarrService(config.prowlarr, logger),
    ai: new AIService(config.ai, logger),
    session: new SessionService(config.session.timeoutMs, logger),
    twilio: new TwilioService(config.twilio, logger),
    tmdb: new TMDBService(config.tmdb, logger),
    user: new UserService(config.users, config.quotas, logger),
    mediaRequest: new MediaRequestService(logger),
    notification: new NotificationService(config.downloadNotifications, logger),
  };
}
