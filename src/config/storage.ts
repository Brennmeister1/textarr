import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

/**
 * Single source of truth for secret fields that need masking and preservation.
 * When adding a new secret field:
 * 1. Add it to this list
 * 2. That's it! Masking and preservation happen automatically.
 */
export const SECRET_FIELDS = [
  'ai.openaiApiKey',
  'ai.anthropicApiKey',
  'ai.googleApiKey',
  'twilio.authToken',
  'telegram.botToken',
  'telegram.webhookSecret',
  'discord.botToken',
  'slack.botToken',
  'slack.signingSecret',
  'slack.appToken',
  'sonarr.apiKey',
  'radarr.apiKey',
  'prowlarr.apiKey',
  'tmdb.apiKey',
  'admin.passwordHash',
  'downloadNotifications.webhookSecret',
] as const;

/**
 * Fields managed by separate endpoints (not the config form).
 * These are preserved entirely when saving config.
 */
export const MANAGED_SEPARATELY_FIELDS = [
  'users',        // managed via /api/users
  'admin',        // managed via /api/auth
  'mediaRequests', // managed internally by the app
] as const;

/**
 * Configuration schema matching the app's needs
 */
export const AppConfigSchema = z.object({
  // Server
  server: z.object({
    port: z.number().default(3030),
    logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    externalUrl: z.string().default(''), // Public URL for webhooks (e.g., https://myserver.com:3030)
  }).default({}),

  // AI
  ai: z.object({
    provider: z.enum(['openai', 'anthropic', 'google']).default('openai'),
    model: z.string().default('gpt-4-turbo'),
    openaiApiKey: z.string().default(''),
    anthropicApiKey: z.string().default(''),
    googleApiKey: z.string().default(''),
    // AI customization options
    temperature: z.number().min(0).max(2).default(0.2),
    responseStyle: z.enum(['brief', 'standard', 'detailed']).default('standard'),
    systemPrompt: z.string().default(''),
  }).default({}),

  // Twilio (SMS)
  twilio: z.object({
    enabled: z.boolean().default(true),
    accountSid: z.string().default(''),
    authToken: z.string().default(''),
    phoneNumber: z.string().default(''),
    // MMS poster images option
    sendPosterImages: z.boolean().default(false),
  }).default({}),

  // Telegram
  telegram: z.object({
    enabled: z.boolean().default(false),
    botToken: z.string().default(''),
    // Optional: whitelist specific chat IDs
    allowedChatIds: z.array(z.string()).default([]),
    // Use polling (true) for development, webhooks (false) for production
    usePolling: z.boolean().default(true),
    // Webhook settings (only used if usePolling is false)
    webhookUrl: z.string().optional(),
    webhookSecret: z.string().optional(),
    // Respond to unregistered users with their ID
    respondToUnregistered: z.boolean().default(true),
  }).default({}),

  // Discord
  discord: z.object({
    enabled: z.boolean().default(false),
    botToken: z.string().default(''),
    // Optional: whitelist specific server IDs
    allowedGuildIds: z.array(z.string()).default([]),
    // Optional: whitelist specific channel IDs
    allowedChannelIds: z.array(z.string()).default([]),
    // Respond to unregistered users with their ID
    respondToUnregistered: z.boolean().default(true),
  }).default({}),

  // Slack
  slack: z.object({
    enabled: z.boolean().default(false),
    botToken: z.string().default(''),
    signingSecret: z.string().default(''),
    // For socket mode (recommended for development)
    appToken: z.string().default(''),
    useSocketMode: z.boolean().default(false),
    // Respond to unregistered users with their ID
    respondToUnregistered: z.boolean().default(true),
  }).default({}),

  // Sonarr
  sonarr: z.object({
    url: z.string().default('http://localhost:8989'),
    apiKey: z.string().default(''),
    qualityProfileId: z.number().default(1),
    rootFolder: z.string().default('/tv'),
    // Anime-specific settings (optional)
    animeRootFolder: z.string().optional(),
    animeQualityProfileId: z.number().optional(),
    animeTagIds: z.array(z.number()).default([]),
  }).default({}),

  // Radarr
  radarr: z.object({
    url: z.string().default('http://localhost:7878'),
    apiKey: z.string().default(''),
    qualityProfileId: z.number().default(1),
    rootFolder: z.string().default('/movies'),
    // Anime-specific settings (optional)
    animeRootFolder: z.string().optional(),
    animeQualityProfileId: z.number().optional(),
    animeTagIds: z.array(z.number()).default([]),
  }).default({}),

  // Prowlarr
  prowlarr: z.object({
    url: z.string().default('http://localhost:9696'),
    apiKey: z.string().default(''),
  }).default({}),

  // TMDB
  tmdb: z.object({
    apiKey: z.string().default(''),
    language: z.string().default('en'),
    watchRegion: z.string().default('US'),
  }).default({}),

  // Users
  users: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    isAdmin: z.boolean().default(false),
    createdAt: z.string().datetime(),
    createdBy: z.string().optional(),
    identities: z.object({
      sms: z.string().optional(),
      discord: z.string().optional(),
      slack: z.string().optional(),
      telegram: z.string().optional(),
    }),
    requestCount: z.object({
      movies: z.number().default(0),
      tvShows: z.number().default(0),
      lastReset: z.string().datetime(),
    }).default({ movies: 0, tvShows: 0, lastReset: new Date().toISOString() }),
    notificationPreferences: z.object({
      enabled: z.boolean().default(true),
    }).default({}),
  })).default([]),

  // Quotas
  quotas: z.object({
    enabled: z.boolean().default(false),
    period: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
    movieLimit: z.number().default(10),
    tvShowLimit: z.number().default(10),
    adminExempt: z.boolean().default(true),
  }).default({}),

  // Session
  session: z.object({
    timeoutMs: z.number().default(300000),
    maxSearchResults: z.number().default(5),
    // Message shown to unregistered users (use {id} and {platform} placeholders)
    unregisteredMessage: z.string().default("You're not registered.\n\nYour {platform} ID: {id}\n\nShare this with your admin to get access!"),
  }).default({}),

  // Admin notifications
  notifications: z.object({
    enabled: z.boolean().default(true),
    platforms: z.array(z.enum(['sms', 'telegram', 'discord', 'slack'])).default(['sms']),
  }).default({}),

  // Download notifications (notify users when media finishes downloading)
  downloadNotifications: z.object({
    enabled: z.boolean().default(true),
    webhookSecret: z.string().default(''),
    messageTemplate: z.string().default('{emoji} {title} is ready to watch!'),
  }).default({}),

  // Configurable messages
  messages: z.object({
    // Acknowledgment
    acknowledgmentEnabled: z.boolean().default(true),
    acknowledgment: z.string().default('One second...'),

    // Errors
    genericError: z.string().default('Something went wrong. Please try again.'),
    notConfigured: z.string().default('Service not configured. Please complete setup.'),

    // Cancel/Reset
    cancelled: z.string().default('Cancelled. Send a new request anytime!'),
    restart: z.string().default('Starting fresh! What would you like to add?'),
    backToStart: z.string().default('Back to the start! What would you like to add?'),
    goodbyeMessage: z.string().default('Sounds good! Let me know if you need anything.'),

    // Prompts
    addPrompt: z.string().default("What would you like to add? Try: 'Add Breaking Bad' or 'Add Dune'"),
    unknownCommand: z.string().default("I didn't understand that. Try: 'Add Breaking Bad' or 'help' for commands."),

    // State messages
    nothingToConfirm: z.string().default('Nothing to confirm. Try requesting a movie or TV show!'),
    nothingToSelect: z.string().default('Nothing to select from. Try searching for a movie or TV show!'),
    noPreviousResults: z.string().default('No previous results to choose from. Try searching for something!'),
    nothingSelected: z.string().default('Nothing selected. Try requesting a movie or TV show!'),
    selectRange: z.string().default('Please select a number between 1 and {max}.'),

    // Search
    noResults: z.string().default('No results found for "{query}". Try checking the spelling or being more specific.'),
    searchResults: z.string().default('Found {count} results for "{query}":'),
    remainingResults: z.string().default('Here are the other results from your search:'),
    selectPrompt: z.string().default('Reply with a number, or search for something else.'),

    // Recommendations
    noRecommendations: z.string().default("Couldn't find any recommendations matching your criteria. Try a different request!"),

    // Confirmation
    confirmPrompt: z.string().default('YES to add, NO to cancel, or pick a different number.'),
    confirmAnimePrompt: z.string().default('YES to add to anime library, NO to cancel, or pick a different number.'),
    animeOrRegularPrompt: z.string().default('This appears to be animated content.\n\nReply ANIME or REGULAR to choose library.'),
    seasonSelectPrompt: z.string().default('Which seasons?\n1. All\n2. First season\n3. Latest season\n4. Future only\n\nReply with a number.'),
    seasonConfirmPrompt: z.string().default('Monitoring: {monitorType}\n\nYES to add, NO to cancel.'),

    // Success
    mediaAdded: z.string().default('{title} added!\n\nIt will start downloading shortly. Want to add anything else?'),
    alreadyAvailable: z.string().default('{title} is available to watch!'),
    alreadyMonitored: z.string().default('{title} is in your library, waiting to download.'),
    alreadyPartial: z.string().default('{title} is partially available.\n{episodeFileCount}/{episodeCount} episodes downloaded ({percentComplete}%)'),
    alreadyWaitingRelease: z.string().default('{title} is in your library, waiting for release.'),
    alreadyWaitingEpisodes: z.string().default('{title} is in your library, waiting for episodes.'),
    alreadyInLibrary: z.string().default('{title} is already in your library!'),

    // Status
    nothingDownloading: z.string().default('Nothing is currently downloading.'),
    currentlyDownloading: z.string().default('Currently downloading:'),

    // Admin
    adminOnly: z.string().default('This command is only available to admins.'),
    noUsers: z.string().default('No users configured.'),
    adminNotification: z.string().default('New Request\n{userName} added:\n{title}'),

    // Quota
    quotaExceeded: z.string().default('Request limit reached\n\n{quotaMessage}'),

    // TVDB error
    tvdbNotFound: z.string().default('Could not find "{title}" in TVDB. Try searching directly with "Add {title} show".'),
    failedToAdd: z.string().default('Failed to add {title}. Please try again.'),

    // State Labels
    labelIdle: z.string().default('Ready for a new request'),
    labelAwaitingSelection: z.string().default('Waiting for you to pick from search results'),
    labelAwaitingConfirmation: z.string().default('Waiting for you to confirm'),
    labelAwaitingAnimeConfirmation: z.string().default('Waiting for anime/regular choice'),
    labelAwaitingSeasonSelection: z.string().default('Waiting for season selection'),

    // Help text (single large field)
    helpText: z.string().default(`Textarr Help

Commands:
• "Add [title]" - Add a movie or TV show
• "Add [title] anime" - Add anime content
• "Status" - Check download progress
• "Help" - Show this message

Examples:
• "Add Breaking Bad"
• "Add Attack on Titan anime"
• "Add Dune 2021"
• "What's downloading?"

When selecting from a list, reply with the number.
Reply YES/NO to confirm or cancel.`),

    // Admin help text
    adminHelpText: z.string().default(`Admin Commands:
• "admin list" - List all users
• "admin add <id> Name" - Add user
• "admin remove <id>" - Remove user
• "admin promote <id>" - Make admin
• "admin demote <id>" - Remove admin
• "admin quota <id> movies +5" - Add quota

User IDs by platform:
• SMS: Phone number (e.g., 5551234567)
• Telegram: telegram:123456789
• Discord: discord:123456789012345678
• Slack: slack:U0123456789`),

    // Media info
    noMediaContext: z.string().default("I'm not sure which movie or TV show you're asking about. Try including the title, like 'Who's in Breaking Bad?' or 'Trailer for Inception'"),
  }).default({}),

  // Media requests tracking (for download notifications)
  mediaRequests: z.array(z.object({
    id: z.string().uuid(),
    mediaType: z.enum(['movie', 'tv_show']),
    title: z.string(),
    year: z.number().nullable(),
    tmdbId: z.number(),
    tvdbId: z.number().optional(),
    radarrId: z.number().optional(),
    sonarrId: z.number().optional(),
    requestedBy: z.string(), // PlatformUserId
    requestedAt: z.string().datetime(),
    status: z.enum(['pending', 'downloading', 'completed', 'failed']).default('pending'),
  })).default([]),

  // Admin credentials for dashboard authentication
  admin: z.object({
    username: z.string().default('admin'),
    passwordHash: z.string().default(''),
  }).default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

const CONFIG_FILE = process.env.CONFIG_FILE || join(process.cwd(), 'config', 'config.json');

/**
 * Get a value from an object using dot notation path (e.g., 'ai.openaiApiKey')
 */
function getPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Set a value in an object using dot notation path (e.g., 'ai.openaiApiKey')
 */
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

/**
 * Mask a secret value for display.
 * Shows last 4 characters for longer secrets, fully masks short ones.
 */
function maskSecret(value: string | undefined): string {
  if (!value || value === '') return '';
  if (value.length > 8) {
    return '••••••••' + value.slice(-4);
  }
  return '••••••••';
}

/**
 * Check if a value appears to be masked (starts with •)
 */
function isMasked(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('••••');
}

/**
 * Preserve secrets from existing config into new config.
 * For each secret field, if the new value is empty or masked, use the existing value.
 */
export function preserveSecrets(newConfig: AppConfig, existingConfig: AppConfig): void {
  for (const path of SECRET_FIELDS) {
    const newValue = getPath(newConfig as unknown as Record<string, unknown>, path);
    const existingValue = getPath(existingConfig as unknown as Record<string, unknown>, path);

    if (!newValue || newValue === '' || isMasked(newValue)) {
      setPath(newConfig as unknown as Record<string, unknown>, path, existingValue);
    }
  }
}

/**
 * Preserve fields that are managed by separate endpoints.
 */
export function preserveManagedFields(newConfig: AppConfig, existingConfig: AppConfig): void {
  for (const field of MANAGED_SEPARATELY_FIELDS) {
    const newValue = getPath(newConfig as unknown as Record<string, unknown>, field);
    const existingValue = getPath(existingConfig as unknown as Record<string, unknown>, field);

    // For arrays, preserve if empty. For objects like admin, preserve if passwordHash is empty/masked.
    if (field === 'admin') {
      const adminNew = newValue as { passwordHash?: string } | undefined;
      if (!adminNew?.passwordHash || adminNew.passwordHash === '' || isMasked(adminNew.passwordHash)) {
        setPath(newConfig as unknown as Record<string, unknown>, field, existingValue);
      }
    } else if (Array.isArray(newValue)) {
      if (newValue.length === 0) {
        setPath(newConfig as unknown as Record<string, unknown>, field, existingValue);
      }
    } else if (!newValue) {
      setPath(newConfig as unknown as Record<string, unknown>, field, existingValue);
    }
  }
}

/**
 * Load configuration from file
 */
export function loadConfig(): AppConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = readFileSync(CONFIG_FILE, 'utf-8');
      const parsed: unknown = JSON.parse(data);
      return AppConfigSchema.parse(parsed);
    }
  } catch {
    // Failed to load config, will use defaults
  }
  
  // Return default config
  return AppConfigSchema.parse({});
}

/**
 * Save configuration to file
 */
export function saveConfig(config: AppConfig): void {
  const validated = AppConfigSchema.parse(config);
  writeFileSync(CONFIG_FILE, JSON.stringify(validated, null, 2), 'utf-8');
}

/**
 * Get configuration for display (with sensitive fields masked).
 * Uses SECRET_FIELDS as the single source of truth.
 */
export function getConfigForDisplay(config: AppConfig): AppConfig {
  // Deep clone to avoid mutating original
  const display = JSON.parse(JSON.stringify(config)) as AppConfig;

  // Mask all secret fields
  for (const path of SECRET_FIELDS) {
    const value = getPath(display as unknown as Record<string, unknown>, path);
    if (typeof value === 'string') {
      setPath(display as unknown as Record<string, unknown>, path, maskSecret(value));
    }
  }

  return display;
}

/**
 * Check if configuration is complete enough to run
 */
export function isConfigComplete(config: AppConfig): { complete: boolean; missing: string[] } {
  const missing: string[] = [];

  // Check AI config
  if (config.ai.provider === 'openai' && !config.ai.openaiApiKey) {
    missing.push('OpenAI API Key');
  }
  if (config.ai.provider === 'anthropic' && !config.ai.anthropicApiKey) {
    missing.push('Anthropic API Key');
  }
  if (config.ai.provider === 'google' && !config.ai.googleApiKey) {
    missing.push('Google API Key');
  }

  // Check that at least one messaging platform is configured
  const hasTwilio = config.twilio.enabled &&
    config.twilio.accountSid &&
    config.twilio.authToken &&
    config.twilio.phoneNumber;
  const hasTelegram = config.telegram.enabled && config.telegram.botToken;
  const hasDiscord = config.discord.enabled && config.discord.botToken;
  const hasSlack = config.slack.enabled && config.slack.botToken && config.slack.signingSecret;

  if (!hasTwilio && !hasTelegram && !hasDiscord && !hasSlack) {
    missing.push('At least one messaging platform (Twilio, Telegram, Discord, or Slack)');
  }

  // Check Sonarr or Radarr (at least one)
  const hasSonarr = config.sonarr.url && config.sonarr.apiKey;
  const hasRadarr = config.radarr.url && config.radarr.apiKey;
  if (!hasSonarr && !hasRadarr) {
    missing.push('Sonarr or Radarr configuration');
  }

  // Check users
  if (config.users.length === 0) {
    missing.push('At least one user');
  }

  return { complete: missing.length === 0, missing };
}
