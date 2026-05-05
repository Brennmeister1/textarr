import 'dotenv/config';

export type { Env } from './env.js';
export { loadConfig, saveConfig, isConfigComplete, AppConfigSchema, type AppConfig } from './storage.js';

/**
 * Application configuration (runtime)
 */
export interface Config {
  server: {
    port: number;
    nodeEnv: string;
    logLevel: string;
    isDev: boolean;
    isProd: boolean;
    externalUrl: string;
  };
  ai: {
    provider: 'openai' | 'anthropic' | 'google';
    model: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    googleApiKey?: string;
    temperature?: number;
    responseStyle?: 'brief' | 'standard' | 'detailed';
    systemPrompt?: string;
  };
  twilio: {
    enabled: boolean;
    accountSid: string;
    authToken: string;
    phoneNumber: string;
    sendPosterImages: boolean;
  };
  telegram: {
    enabled: boolean;
    botToken: string;
    allowedChatIds: string[];
    usePolling: boolean;
    webhookUrl?: string;
    webhookSecret?: string;
    respondToUnregistered: boolean;
  };
  discord: {
    enabled: boolean;
    botToken: string;
    allowedGuildIds: string[];
    allowedChannelIds: string[];
    respondToUnregistered: boolean;
  };
  slack: {
    enabled: boolean;
    botToken: string;
    signingSecret: string;
    appToken: string;
    useSocketMode: boolean;
    respondToUnregistered: boolean;
  };
  sonarr: {
    url: string;
    apiKey: string;
    qualityProfileId: number;
    rootFolder: string;
    animeRootFolder?: string;
    animeQualityProfileId?: number;
    animeTagIds: number[];
  };
  radarr: {
    url: string;
    apiKey: string;
    qualityProfileId: number;
    rootFolder: string;
    animeRootFolder?: string;
    animeQualityProfileId?: number;
    animeTagIds: number[];
  };
  prowlarr: {
    url: string;
    apiKey: string;
  };
  tmdb: {
    apiKey: string;
    language: string;
    watchRegion: string;
  };
  users: User[];
  quotas: {
    enabled: boolean;
    period: 'daily' | 'weekly' | 'monthly';
    movieLimit: number;
    tvShowLimit: number;
    adminExempt: boolean;
  };
  session: {
    timeoutMs: number;
    maxSearchResults: number;
    unregisteredMessage: string;
  };
  notifications: {
    enabled: boolean;
    platforms: ('sms' | 'telegram' | 'discord' | 'slack')[];
  };
  downloadNotifications: {
    enabled: boolean;
    webhookSecret: string;
    messageTemplate: string;
  };
  messages: {
    // Acknowledgment
    acknowledgmentEnabled: boolean;
    acknowledgment: string;
    // Errors
    genericError: string;
    notConfigured: string;
    // Cancel/Reset
    cancelled: string;
    restart: string;
    backToStart: string;
    goodbyeMessage: string;
    // Prompts
    addPrompt: string;
    unknownCommand: string;
    // State messages
    nothingToConfirm: string;
    nothingToSelect: string;
    noPreviousResults: string;
    nothingSelected: string;
    selectRange: string;
    // Search
    noResults: string;
    searchResults: string;
    remainingResults: string;
    selectPrompt: string;
    // Recommendations
    noRecommendations: string;
    // Confirmation
    confirmPrompt: string;
    confirmAnimePrompt: string;
    animeOrRegularPrompt: string;
    seasonSelectPrompt: string;
    seasonConfirmPrompt: string;
    // Success
    mediaAdded: string;
    alreadyAvailable: string;
    alreadyMonitored: string;
    alreadyPartial: string;
    alreadyWaitingRelease: string;
    alreadyWaitingEpisodes: string;
    alreadyInLibrary: string;
    // Status
    nothingDownloading: string;
    currentlyDownloading: string;
    // Admin
    adminOnly: string;
    noUsers: string;
    adminNotification: string;
    // Quota
    quotaExceeded: string;
    // Errors
    tvdbNotFound: string;
    failedToAdd: string;
    // State Labels
    labelIdle: string;
    labelAwaitingSelection: string;
    labelAwaitingConfirmation: string;
    labelAwaitingAnimeConfirmation: string;
    labelAwaitingSeasonSelection: string;
    // Help
    helpText: string;
    adminHelpText: string;
    // Media info
    noMediaContext: string;
  };
}

/**
 * Platform identities for a user (can be linked to multiple platforms)
 */
export interface UserIdentities {
  sms?: string; // Phone number
  discord?: string; // Discord user ID
  slack?: string; // Slack user ID
  telegram?: string; // Telegram user ID
}

/**
 * User model for authorization and tracking
 */
export interface User {
  id: string; // UUID
  name: string;
  isAdmin: boolean;
  createdAt: string;
  createdBy?: string;
  identities: UserIdentities;
  requestCount: {
    movies: number;
    tvShows: number;
    lastReset: string;
  };
  notificationPreferences: {
    enabled: boolean;
  };
}

/**
 * Media request for tracking download notifications
 */
export interface MediaRequest {
  id: string;
  mediaType: 'movie' | 'tv_show';
  title: string;
  year: number | null;
  tmdbId: number;
  tvdbId?: number;
  radarrId?: number;
  sonarrId?: number;
  requestedBy: string; // PlatformUserId
  requestedAt: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
}
