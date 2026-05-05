import 'dotenv/config';
import { createLogger } from './utils/logger.js';
import { ServiceContainer } from './services/index.js';
import { createServer } from './server.js';
import { loadConfig, isConfigComplete } from './config/storage.js';
import type { Config, User } from './config/index.js';
import type { AppConfig } from './config/storage.js';
import { MessagingManager } from './messaging/manager.js';
import { TelegramProvider } from './messaging/providers/telegram.provider.js';
import { DiscordProvider } from './messaging/providers/discord.provider.js';
import { SlackProvider } from './messaging/providers/slack.provider.js';
import { MessageHandler } from './handlers/index.js';
import type { MessageResponse } from './messaging/types.js';

/**
 * Convert stored AppConfig to runtime Config
 */
export function buildRuntimeConfig(appConfig: AppConfig): Config {
  return {
    server: {
      port: appConfig.server.port,
      nodeEnv: process.env.NODE_ENV || 'development',
      logLevel: appConfig.server.logLevel,
      isDev: process.env.NODE_ENV !== 'production',
      isProd: process.env.NODE_ENV === 'production',
      externalUrl: appConfig.server.externalUrl,
    },
    ai: {
      provider: appConfig.ai.provider,
      model: appConfig.ai.model,
      openaiApiKey: appConfig.ai.openaiApiKey,
      anthropicApiKey: appConfig.ai.anthropicApiKey,
      googleApiKey: appConfig.ai.googleApiKey,
      temperature: appConfig.ai.temperature,
      responseStyle: appConfig.ai.responseStyle,
      systemPrompt: appConfig.ai.systemPrompt,
    },
    twilio: {
      enabled: appConfig.twilio.enabled,
      accountSid: appConfig.twilio.accountSid,
      authToken: appConfig.twilio.authToken,
      phoneNumber: appConfig.twilio.phoneNumber,
      sendPosterImages: appConfig.twilio.sendPosterImages,
    },
    telegram: {
      enabled: appConfig.telegram.enabled,
      botToken: appConfig.telegram.botToken,
      allowedChatIds: appConfig.telegram.allowedChatIds,
      usePolling: appConfig.telegram.usePolling,
      webhookUrl: appConfig.telegram.webhookUrl,
      webhookSecret: appConfig.telegram.webhookSecret,
      respondToUnregistered: appConfig.telegram.respondToUnregistered,
    },
    discord: {
      enabled: appConfig.discord.enabled,
      botToken: appConfig.discord.botToken,
      allowedGuildIds: appConfig.discord.allowedGuildIds,
      allowedChannelIds: appConfig.discord.allowedChannelIds,
      respondToUnregistered: appConfig.discord.respondToUnregistered,
    },
    slack: {
      enabled: appConfig.slack.enabled,
      botToken: appConfig.slack.botToken,
      signingSecret: appConfig.slack.signingSecret,
      appToken: appConfig.slack.appToken,
      useSocketMode: appConfig.slack.useSocketMode,
      respondToUnregistered: appConfig.slack.respondToUnregistered,
    },
    sonarr: {
      url: appConfig.sonarr.url,
      apiKey: appConfig.sonarr.apiKey,
      qualityProfileId: appConfig.sonarr.qualityProfileId,
      rootFolder: appConfig.sonarr.rootFolder,
      animeRootFolder: appConfig.sonarr.animeRootFolder,
      animeQualityProfileId: appConfig.sonarr.animeQualityProfileId,
      animeTagIds: appConfig.sonarr.animeTagIds,
    },
    radarr: {
      url: appConfig.radarr.url,
      apiKey: appConfig.radarr.apiKey,
      qualityProfileId: appConfig.radarr.qualityProfileId,
      rootFolder: appConfig.radarr.rootFolder,
      animeRootFolder: appConfig.radarr.animeRootFolder,
      animeQualityProfileId: appConfig.radarr.animeQualityProfileId,
      animeTagIds: appConfig.radarr.animeTagIds,
    },
    tmdb: {
      apiKey: appConfig.tmdb.apiKey,
      language: appConfig.tmdb.language,
      watchRegion: appConfig.tmdb.watchRegion,
    },
    users: Array.isArray(appConfig.users) ? (appConfig.users as User[]) : [],
    quotas: {
      enabled: appConfig.quotas.enabled,
      period: appConfig.quotas.period,
      movieLimit: appConfig.quotas.movieLimit,
      tvShowLimit: appConfig.quotas.tvShowLimit,
      adminExempt: appConfig.quotas.adminExempt,
    },
    session: {
      timeoutMs: appConfig.session.timeoutMs,
      maxSearchResults: appConfig.session.maxSearchResults,
      unregisteredMessage: appConfig.session.unregisteredMessage,
    },
    notifications: {
      enabled: appConfig.notifications.enabled,
      platforms: appConfig.notifications.platforms,
    },
    downloadNotifications: {
      enabled: appConfig.downloadNotifications.enabled,
      webhookSecret: appConfig.downloadNotifications.webhookSecret,
      messageTemplate: appConfig.downloadNotifications.messageTemplate,
    },
    messages: {
      acknowledgmentEnabled: appConfig.messages.acknowledgmentEnabled,
      acknowledgment: appConfig.messages.acknowledgment,
      genericError: appConfig.messages.genericError,
      notConfigured: appConfig.messages.notConfigured,
      cancelled: appConfig.messages.cancelled,
      restart: appConfig.messages.restart,
      backToStart: appConfig.messages.backToStart,
      goodbyeMessage: appConfig.messages.goodbyeMessage,
      addPrompt: appConfig.messages.addPrompt,
      unknownCommand: appConfig.messages.unknownCommand,
      nothingToConfirm: appConfig.messages.nothingToConfirm,
      nothingToSelect: appConfig.messages.nothingToSelect,
      noPreviousResults: appConfig.messages.noPreviousResults,
      nothingSelected: appConfig.messages.nothingSelected,
      selectRange: appConfig.messages.selectRange,
      noResults: appConfig.messages.noResults,
      searchResults: appConfig.messages.searchResults,
      remainingResults: appConfig.messages.remainingResults,
      selectPrompt: appConfig.messages.selectPrompt,
      noRecommendations: appConfig.messages.noRecommendations,
      confirmPrompt: appConfig.messages.confirmPrompt,
      confirmAnimePrompt: appConfig.messages.confirmAnimePrompt,
      animeOrRegularPrompt: appConfig.messages.animeOrRegularPrompt,
      seasonSelectPrompt: appConfig.messages.seasonSelectPrompt,
      seasonConfirmPrompt: appConfig.messages.seasonConfirmPrompt,
      mediaAdded: appConfig.messages.mediaAdded,
      alreadyAvailable: appConfig.messages.alreadyAvailable,
      alreadyMonitored: appConfig.messages.alreadyMonitored,
      alreadyPartial: appConfig.messages.alreadyPartial,
      alreadyWaitingRelease: appConfig.messages.alreadyWaitingRelease,
      alreadyWaitingEpisodes: appConfig.messages.alreadyWaitingEpisodes,
      alreadyInLibrary: appConfig.messages.alreadyInLibrary,
      nothingDownloading: appConfig.messages.nothingDownloading,
      currentlyDownloading: appConfig.messages.currentlyDownloading,
      adminOnly: appConfig.messages.adminOnly,
      noUsers: appConfig.messages.noUsers,
      adminNotification: appConfig.messages.adminNotification,
      quotaExceeded: appConfig.messages.quotaExceeded,
      tvdbNotFound: appConfig.messages.tvdbNotFound,
      failedToAdd: appConfig.messages.failedToAdd,
      labelIdle: appConfig.messages.labelIdle,
      labelAwaitingSelection: appConfig.messages.labelAwaitingSelection,
      labelAwaitingConfirmation: appConfig.messages.labelAwaitingConfirmation,
      labelAwaitingAnimeConfirmation: appConfig.messages.labelAwaitingAnimeConfirmation,
      labelAwaitingSeasonSelection: appConfig.messages.labelAwaitingSeasonSelection,
      helpText: appConfig.messages.helpText,
      adminHelpText: appConfig.messages.adminHelpText,
      noMediaContext: appConfig.messages.noMediaContext,
    },
  };
}

async function main() {
  // Load configuration from file
  const appConfig = loadConfig();
  const configStatus = isConfigComplete(appConfig);

  // Create logger
  const logger = createLogger(appConfig.server.logLevel || 'info', process.env.NODE_ENV !== 'production');
  logger.info({ env: process.env.NODE_ENV || 'development' }, 'Starting Textarr');

  // Create service container
  const container = new ServiceContainer(logger);
  let messagingManager: MessagingManager | undefined;

  // Initialize services if configuration is complete
  if (configStatus.complete) {
    logger.info('Configuration complete, initializing services...');

    // Convert stored config to runtime config
    const config = buildRuntimeConfig(appConfig);

    // Initialize services via container
    const result = await container.initialize(config);

    if (!result.success) {
      logger.error({ errors: result.errors }, 'Failed to initialize services');
      // Continue anyway - user can fix via web UI
    } else {
      // Test connections
      logger.info('Testing service connections...');
      const connections = await container.testConnections();

      if (!connections.sonarr) {
        logger.warn('Sonarr connection failed - TV show features may not work');
      }
      if (!connections.radarr) {
        logger.warn('Radarr connection failed - Movie features may not work');
      }
    }
  } else {
    logger.info(`  ⚠️  Setup Required: Complete configuration in web UI`);
  }

  // Initialize messaging providers (independent of full config completeness)
  try {
    const config = buildRuntimeConfig(appConfig);
    
    // Create messaging manager if not already created
    if (!messagingManager) {
      messagingManager = new MessagingManager(logger);
    }

    // Create and register Telegram provider
    if (config.telegram.enabled && config.telegram.botToken) {
      try {
        const telegramProvider = new TelegramProvider(
          config.telegram,
          container.session,
          logger
        );
        messagingManager.registerProvider(telegramProvider);
        logger.info('Telegram provider registered');
      } catch (error) {
        logger.error({ error }, 'Failed to create Telegram provider');
      }
    }

    // Create and register Discord provider
    if (config.discord.enabled && config.discord.botToken) {
      try {
        const discordProvider = new DiscordProvider(
          config.discord,
          container.session,
          logger
        );
        messagingManager.registerProvider(discordProvider);
        logger.info('Discord provider registered');
      } catch (error) {
        logger.error({ error }, 'Failed to create Discord provider');
      }
    }

    // Create and register Slack provider
    if (config.slack.enabled && config.slack.botToken) {
      try {
        const slackProvider = new SlackProvider(
          config.slack,
          container.session,
          logger
        );
        messagingManager.registerProvider(slackProvider);
        logger.info('Slack provider registered');
      } catch (error) {
        logger.error({ error }, 'Failed to create Slack provider');
      }
    }

    // Set message handler if we have services
    if (container.isInitialized) {
      const messageHandlerInstance = new MessageHandler(container.all, config, logger);
      messagingManager.setMessageHandler(async (userId, message) => {
        return messageHandlerInstance.handleMessage(userId, message);
      });
    }

    // Start all messaging providers (even if other services aren't fully initialized)
    if (messagingManager.getEnabledProviders().length > 0) {
      await messagingManager.start();
      logger.info('Messaging providers started');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to initialize messaging providers');
  }

  // Create and start server
  const server = await createServer(container, logger);
  const port = appConfig.server.port || 3030;

  try {
    await server.listen({
      port,
      host: '0.0.0.0',
    });

    logger.info({ port }, 'Server started');
    logger.info('');
    logger.info('═══════════════════════════════════════════');
    logger.info(`  🎬 Textarr is running!`);
    logger.info(`  📱 Web Interface: http://localhost:${port}`);
    if (configStatus.complete) {
      logger.info(`  📨 SMS Webhook:   http://localhost:${port}/webhooks/sms`);
      logger.info(`  ❤️  Health Check: http://localhost:${port}/health`);
    } else {
      logger.info(`  ⚠️  Setup Required: Complete configuration in web UI`);
    }
    logger.info('═══════════════════════════════════════════');
    logger.info('');
  } catch (error) {
    logger.fatal({ error }, 'Failed to start server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');

    await container.cleanup();
    await server.close();

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
