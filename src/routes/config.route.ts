import type { FastifyInstance } from 'fastify';
import type { Logger } from '../utils/logger.js';
import type { ServiceContainer } from '../services/index.js';
import type { UserIdentities } from '../config/index.js';
import { ZodError } from 'zod';
import { randomUUID } from 'crypto';
import {
  loadConfig,
  saveConfig,
  getConfigForDisplay,
  isConfigComplete,
  preserveSecrets,
  preserveManagedFields,
  AppConfigSchema,
  type AppConfig,
} from '../config/storage.js';
import { buildRuntimeConfig } from '../index.js';

interface TestConnectionBody {
  type: 'sonarr' | 'radarr' | 'prowlarr';
  url: string;
  apiKey: string;
}

interface TestAIBody {
  provider: 'openai' | 'anthropic' | 'google';
  model: string;
  apiKey: string;
}

interface FetchModelsBody {
  provider: 'openai' | 'anthropic' | 'google';
  apiKey: string;
}

interface ModelOption {
  value: string;
  label: string;
}

// Helper to format model IDs into readable labels
function formatModelLabel(modelId: string): string {
  return modelId
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Gpt/g, 'GPT')
    .replace(/(\d{8})$/, '($1)'); // Format date suffix
}

// Helper to normalize SMS phone numbers - strip special characters and auto-prepend +1 if no country code
function normalizeSmsNumber(phone: string | undefined): string | undefined {
  if (!phone) return undefined;

  // Strip all non-digit characters except leading +
  const hasCountryCode = phone.startsWith('+');
  const digits = phone.replace(/\D/g, '');

  if (hasCountryCode) {
    return '+' + digits;
  }
  // Auto-prepend +1 (US default)
  return '+1' + digits;
}

// Fallback models when API fails
const FALLBACK_MODELS: Record<string, ModelOption[]> = {
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  ],
  google: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  ],
};

/**
 * Register configuration API routes
 */
export async function configRoutes(fastify: FastifyInstance, container: ServiceContainer, logger: Logger) {
  const log = logger.child({ route: 'config' });

  // Get current configuration (masked)
  fastify.get('/api/config', async () => {
    const config = loadConfig();
    return {
      config: getConfigForDisplay(config),
      status: isConfigComplete(config),
    };
  });

  // Get raw configuration (for form population)
  fastify.get('/api/config/raw', async () => {
    const config = loadConfig();
    return { config };
  });

  // Get default system prompt (for AI settings)
  fastify.get('/api/config/default-system-prompt', async () => {
    const { getDefaultSystemPrompt } = await import('../services/ai.service.js');
    return { prompt: getDefaultSystemPrompt() };
  });

  // Get or generate webhook secret for download notifications
  fastify.get('/api/config/webhook-secret', async () => {
    const config = loadConfig();

    // Generate webhook secret if not set
    if (!config.downloadNotifications.webhookSecret) {
      config.downloadNotifications.webhookSecret = randomUUID();
      saveConfig(config);
      log.info('Generated new webhook secret for download notifications');
    }

    return { webhookSecret: config.downloadNotifications.webhookSecret };
  });

  // Save configuration and auto-apply
  fastify.post<{ Body: AppConfig }>('/api/config', async (request, reply) => {
    try {
      const newConfig = AppConfigSchema.parse(request.body);
      const existingConfig = loadConfig();

      // Preserve secrets and managed fields using centralized helpers.
      // This uses SECRET_FIELDS and MANAGED_SEPARATELY_FIELDS as single source of truth.
      // To add a new secret field, just add it to SECRET_FIELDS in storage.ts.
      preserveSecrets(newConfig, existingConfig);
      preserveManagedFields(newConfig, existingConfig);

      // Save config to disk
      saveConfig(newConfig);
      log.info('Configuration saved');

      // Check if configuration is complete
      const configStatus = isConfigComplete(newConfig);

      if (!configStatus.complete) {
        // Config incomplete - just save, don't apply
        return {
          success: true,
          applied: false,
          config: getConfigForDisplay(newConfig),
          status: configStatus,
        };
      }

      // Check for port changes (require restart)
      if (container.currentConfig && container.currentConfig.server.port !== newConfig.server.port) {
        return {
          success: true,
          requiresRestart: true,
          message: 'Configuration saved. Port change requires restart.',
          config: getConfigForDisplay(newConfig),
          status: configStatus,
        };
      }

      // Auto-apply: reinitialize services
      log.info('Auto-applying configuration...');
      const runtimeConfig = buildRuntimeConfig(newConfig);
      const result = await container.initialize(runtimeConfig);

      if (!result.success) {
        log.error({ errors: result.errors }, 'Failed to apply configuration');
        return {
          success: true, // Config saved, but apply failed
          applied: false,
          errors: result.errors,
          message: 'Configuration saved but failed to apply',
          config: getConfigForDisplay(newConfig),
          status: configStatus,
        };
      }

      // Test connections
      const connections = await container.testConnections();

      log.info('Configuration saved and applied successfully');
      return {
        success: true,
        applied: true,
        message: 'Configuration saved and applied',
        config: getConfigForDisplay(newConfig),
        status: configStatus,
        services: {
          sonarr: connections.sonarr,
          radarr: connections.radarr,
        },
      };
    } catch (error) {
      log.error({ error }, 'Failed to save configuration');

      // Return detailed Zod validation errors
      if (error instanceof ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error.errors.map((e) => ({
            path: e.path,
            message: e.message,
            code: e.code,
          })),
        });
      }

      return reply.status(400).send({ error: 'Invalid configuration' });
    }
  });

  // Test Sonarr/Radarr/Prowlarr connection
  fastify.post<{ Body: TestConnectionBody }>('/api/config/test-connection', async (request) => {
    const { type, url, apiKey } = request.body;
    
    try {
      const baseUrl = url.replace(/\/$/, '');
      const apiVersion = type === 'prowlarr' ? 'v1' : 'v3';
      const response = await fetch(`${baseUrl}/api/${apiVersion}/system/status`, {
        headers: { 'X-Api-Key': apiKey },
      });
      
      if (response.ok) {
        const data = await response.json() as { version?: string };
        return {
          success: true,
          message: `Connected to ${type} v${data.version || 'unknown'}`,
        };
      } else {
        return {
          success: false,
          message: `Failed to connect: ${response.statusText}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  });

  // Get Sonarr/Radarr quality profiles
  fastify.post<{ Body: { type: 'sonarr' | 'radarr'; url: string; apiKey: string } }>(
    '/api/config/quality-profiles',
    async (request) => {
      const { url, apiKey } = request.body;
      
      try {
        const baseUrl = url.replace(/\/$/, '');
        const response = await fetch(`${baseUrl}/api/v3/qualityprofile`, {
          headers: { 'X-Api-Key': apiKey },
        });
        
        if (response.ok) {
          const profiles = await response.json() as Array<{ id: number; name: string }>;
          return { success: true, profiles };
        } else {
          return { success: false, profiles: [] };
        }
      } catch {
        return { success: false, profiles: [] };
      }
    }
  );

  // Get Sonarr/Radarr root folders
  fastify.post<{ Body: { type: 'sonarr' | 'radarr'; url: string; apiKey: string } }>(
    '/api/config/root-folders',
    async (request) => {
      const { url, apiKey } = request.body;

      try {
        const baseUrl = url.replace(/\/$/, '');
        const response = await fetch(`${baseUrl}/api/v3/rootfolder`, {
          headers: { 'X-Api-Key': apiKey },
        });

        if (response.ok) {
          const folders = await response.json() as Array<{ id: number; path: string }>;
          return { success: true, folders };
        } else {
          return { success: false, folders: [] };
        }
      } catch {
        return { success: false, folders: [] };
      }
    }
  );

  // Get Sonarr/Radarr tags
  fastify.post<{ Body: { type: 'sonarr' | 'radarr'; url: string; apiKey: string } }>(
    '/api/config/tags',
    async (request) => {
      const { url, apiKey } = request.body;

      try {
        const baseUrl = url.replace(/\/$/, '');
        const response = await fetch(`${baseUrl}/api/v3/tag`, {
          headers: { 'X-Api-Key': apiKey },
        });

        if (response.ok) {
          const tags = await response.json() as Array<{ id: number; label: string }>;
          return { success: true, tags };
        } else {
          return { success: false, tags: [] };
        }
      } catch {
        return { success: false, tags: [] };
      }
    }
  );

  // Test TMDB connection
  fastify.post<{ Body: { apiKey: string } }>('/api/config/test-tmdb', async (request) => {
    const { apiKey } = request.body;

    if (!apiKey) {
      return { success: false, message: 'API key is required' };
    }

    try {
      // Try Bearer token first (recommended method for API Read Access Token)
      let response = await fetch('https://api.themoviedb.org/3/movie/popular?page=1', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
        },
      });

      // If Bearer fails, try api_key query param (legacy v3 API key method)
      if (response.status === 401) {
        response = await fetch(
          `https://api.themoviedb.org/3/movie/popular?api_key=${apiKey}&page=1`
        );
      }

      if (response.ok) {
        return { success: true, message: 'TMDB API key valid' };
      } else if (response.status === 401) {
        return { success: false, message: 'Invalid TMDB API key' };
      } else {
        return { success: false, message: `TMDB error: ${response.statusText}` };
      }
    } catch (error) {
      return {
        success: false,
        message: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  });

  // Test Twilio credentials
  fastify.post<{ Body: { accountSid: string; authToken: string; phoneNumber: string } }>(
    '/api/config/test-twilio',
    async (request) => {
      const { accountSid, authToken, phoneNumber: _phoneNumber } = request.body;

      if (!accountSid || !authToken) {
        return { success: false, message: 'Account SID and Auth Token are required' };
      }

      try {
        // Test by fetching account info
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
          {
            headers: {
              Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
            },
          }
        );

        if (response.ok) {
          const data = await response.json() as { friendly_name?: string; status?: string };
          const status = data.status === 'active' ? 'active' : data.status;
          return {
            success: true,
            message: `Twilio account "${data.friendly_name || accountSid}" is ${status}`,
          };
        } else if (response.status === 401) {
          return { success: false, message: 'Invalid Twilio credentials' };
        } else {
          return { success: false, message: `Twilio error: ${response.statusText}` };
        }
      } catch (error) {
        return {
          success: false,
          message: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    }
  );

  // Test AI configuration
  fastify.post<{ Body: TestAIBody }>('/api/config/test-ai', async (request) => {
    const { provider, model, apiKey } = request.body;
    
    try {
      if (provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        
        if (response.ok) {
          return { success: true, message: `OpenAI API key valid. Model: ${model}` };
        } else {
          return { success: false, message: 'Invalid OpenAI API key' };
        }
      } else if (provider === 'anthropic') {
        // Anthropic doesn't have a simple validation endpoint, so we just check format
        if (apiKey.startsWith('sk-ant-')) {
          return { success: true, message: `Anthropic API key format valid. Model: ${model}` };
        } else {
          return { success: false, message: 'Invalid Anthropic API key format' };
        }
      } else if (provider === 'google') {
        // Test Google API by listing models
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );

        if (response.ok) {
          return { success: true, message: `Google API key valid. Model: ${model}` };
        } else {
          return { success: false, message: 'Invalid Google API key' };
        }
      }

      return { success: false, message: 'Unknown provider' };
    } catch (error) {
      return {
        success: false,
        message: `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  });

  // Fetch available AI models from provider APIs
  fastify.post<{ Body: FetchModelsBody }>('/api/config/ai-models', async (request) => {
    const { provider, apiKey } = request.body;

    if (!apiKey) {
      return {
        success: true,
        models: FALLBACK_MODELS[provider] || [],
        source: 'fallback' as const,
      };
    }

    try {
      let models: ModelOption[] = [];

      if (provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });

        if (response.ok) {
          const data = await response.json() as { data: Array<{ id: string }> };
          // Filter to GPT chat models only
          const chatModels = data.data
            .filter((m) => {
              const id = m.id.toLowerCase();
              return (
                (id.startsWith('gpt-4') || id.startsWith('gpt-3.5') || id.startsWith('o1') || id.startsWith('o3')) &&
                !id.includes('instruct') &&
                !id.includes('vision') &&
                !id.includes('realtime') &&
                !id.includes('audio')
              );
            })
            .map((m) => ({
              value: m.id,
              label: formatModelLabel(m.id),
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

          models = chatModels.length > 0 ? chatModels : FALLBACK_MODELS.openai!;
        }
      } else if (provider === 'anthropic') {
        const response = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'X-Api-Key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        });

        if (response.ok) {
          const data = await response.json() as { data: Array<{ id: string; display_name?: string }> };
          models = data.data
            .filter((m) => m.id.startsWith('claude'))
            .map((m) => ({
              value: m.id,
              label: m.display_name || formatModelLabel(m.id),
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

          if (models.length === 0) {
            models = FALLBACK_MODELS.anthropic!;
          }
        }
      } else if (provider === 'google') {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );

        if (response.ok) {
          const data = await response.json() as {
            models: Array<{
              name: string;
              displayName?: string;
              supportedGenerationMethods?: string[];
            }>;
          };
          models = data.models
            .filter(
              (m) =>
                m.name.includes('gemini') &&
                m.supportedGenerationMethods?.includes('generateContent')
            )
            .map((m) => {
              // Extract model ID from "models/gemini-1.5-pro" format
              const modelId = m.name.replace('models/', '');
              return {
                value: modelId,
                label: m.displayName || formatModelLabel(modelId),
              };
            })
            .sort((a, b) => a.label.localeCompare(b.label));

          if (models.length === 0) {
            models = FALLBACK_MODELS.google!;
          }
        }
      }

      // If we got models from API, return them
      if (models.length > 0) {
        return {
          success: true,
          models,
          source: 'api' as const,
        };
      }

      // Fall back to defaults
      return {
        success: true,
        models: FALLBACK_MODELS[provider] || [],
        source: 'fallback' as const,
      };
    } catch (error) {
      log.warn({ error, provider }, 'Failed to fetch models from API, using fallback');
      return {
        success: true,
        models: FALLBACK_MODELS[provider] || [],
        source: 'fallback' as const,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // ============================================
  // User Management Endpoints
  // ============================================

  // Get all users
  fastify.get('/api/users', async () => {
    const config = loadConfig();
    return { users: config.users };
  });

  // Add a new user
  fastify.post<{ Body: { name: string; identities: UserIdentities; isAdmin?: boolean } }>(
    '/api/users',
    async (request, reply) => {
      const { name, identities, isAdmin = false } = request.body;

      if (!name || !identities) {
        return reply.status(400).send({ error: 'name and identities are required' });
      }

      // Check that at least one identity is provided
      const hasIdentity = identities.sms || identities.discord || identities.slack || identities.telegram;
      if (!hasIdentity) {
        return reply.status(400).send({ error: 'At least one identity (sms, discord, slack, or telegram) is required' });
      }

      // Normalize SMS number (auto-prepend +1 if no country code)
      if (identities.sms) {
        identities.sms = normalizeSmsNumber(identities.sms);
      }

      const config = loadConfig();

      // Check for duplicate identities
      for (const user of config.users) {
        if (identities.sms && user.identities.sms === identities.sms) {
          return reply.status(409).send({ error: 'User with this SMS identity already exists' });
        }
        if (identities.discord && user.identities.discord === identities.discord) {
          return reply.status(409).send({ error: 'User with this Discord identity already exists' });
        }
        if (identities.slack && user.identities.slack === identities.slack) {
          return reply.status(409).send({ error: 'User with this Slack identity already exists' });
        }
        if (identities.telegram && user.identities.telegram === identities.telegram) {
          return reply.status(409).send({ error: 'User with this Telegram identity already exists' });
        }
      }

      const now = new Date().toISOString();
      const newUser = {
        id: randomUUID(),
        name,
        identities,
        isAdmin,
        createdAt: now,
        requestCount: {
          movies: 0,
          tvShows: 0,
          lastReset: now,
        },
        notificationPreferences: {
          enabled: true,
        },
      };

      config.users.push(newUser);
      saveConfig(config);

      log.info({ name, identities }, 'User added');
      return { success: true, user: newUser };
    }
  );

  // Update a user
  fastify.put<{ Params: { id: string }; Body: { name?: string; isAdmin?: boolean; identities?: UserIdentities } }>(
    '/api/users/:id',
    async (request, reply) => {
      const { id } = request.params;
      const { name, isAdmin, identities } = request.body;

      const config = loadConfig();
      const userIndex = config.users.findIndex((u) => u.id === id);

      if (userIndex === -1) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Handle identities update - check for duplicates
      if (identities) {
        // Normalize SMS number (auto-prepend +1 if no country code)
        if (identities.sms) {
          identities.sms = normalizeSmsNumber(identities.sms);
        }

        for (const [i, user] of config.users.entries()) {
          if (i === userIndex) continue;
          if (identities.sms && user.identities.sms === identities.sms) {
            return reply.status(409).send({ error: 'SMS identity already in use' });
          }
          if (identities.discord && user.identities.discord === identities.discord) {
            return reply.status(409).send({ error: 'Discord identity already in use' });
          }
          if (identities.slack && user.identities.slack === identities.slack) {
            return reply.status(409).send({ error: 'Slack identity already in use' });
          }
          if (identities.telegram && user.identities.telegram === identities.telegram) {
            return reply.status(409).send({ error: 'Telegram identity already in use' });
          }
        }
        config.users[userIndex]!.identities = identities;
      }

      if (name !== undefined) {
        config.users[userIndex]!.name = name;
      }
      if (isAdmin !== undefined) {
        config.users[userIndex]!.isAdmin = isAdmin;
      }

      saveConfig(config);

      log.info({ id, name }, 'User updated');
      return { success: true, user: config.users[userIndex] };
    }
  );

  // Delete a user
  fastify.delete<{ Params: { id: string } }>(
    '/api/users/:id',
    async (request, reply) => {
      const { id } = request.params;

      const config = loadConfig();
      const userIndex = config.users.findIndex((u) => u.id === id);

      if (userIndex === -1) {
        return reply.status(404).send({ error: 'User not found' });
      }

      config.users.splice(userIndex, 1);
      saveConfig(config);

      log.info({ id }, 'User deleted');
      return { success: true };
    }
  );

  // ============================================
  // Quota Management Endpoints
  // ============================================

  // Get quota configuration
  fastify.get('/api/quotas', async () => {
    const config = loadConfig();
    return { quotas: config.quotas };
  });

  // Update quota configuration
  fastify.put<{
    Body: {
      enabled?: boolean;
      period?: 'daily' | 'weekly' | 'monthly';
      movieLimit?: number;
      tvShowLimit?: number;
      adminExempt?: boolean;
    };
  }>('/api/quotas', async (request) => {
    const config = loadConfig();

    if (request.body.enabled !== undefined) {
      config.quotas.enabled = request.body.enabled;
    }
    if (request.body.period !== undefined) {
      config.quotas.period = request.body.period;
    }
    if (request.body.movieLimit !== undefined) {
      config.quotas.movieLimit = request.body.movieLimit;
    }
    if (request.body.tvShowLimit !== undefined) {
      config.quotas.tvShowLimit = request.body.tvShowLimit;
    }
    if (request.body.adminExempt !== undefined) {
      config.quotas.adminExempt = request.body.adminExempt;
    }

    saveConfig(config);

    log.info({ quotas: config.quotas }, 'Quotas updated');
    return { success: true, quotas: config.quotas };
  });

  // Reset user quotas (admin action)
  fastify.post<{ Params: { id: string } }>(
    '/api/users/:id/reset-quota',
    async (request, reply) => {
      const { id } = request.params;

      const config = loadConfig();
      const userIndex = config.users.findIndex((u) => u.id === id);

      if (userIndex === -1) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const now = new Date().toISOString();
      config.users[userIndex]!.requestCount = {
        movies: 0,
        tvShows: 0,
        lastReset: now,
      };

      saveConfig(config);

      log.info({ id }, 'User quota reset');
      return { success: true, user: config.users[userIndex] };
    }
  );

  // ============================================
  // Webhook Setup Endpoints
  // ============================================

  interface WebhookSetupBody {
    url: string;
    apiKey: string;
  }

  interface ArrNotification {
    id?: number;
    name: string;
    implementation: string;
    configContract: string;
    onDownload?: boolean;
    onUpgrade?: boolean;
    onImportComplete?: boolean;
    fields?: Array<{ name: string; value: unknown }>;
  }

  // Setup webhook in Sonarr
  fastify.post<{ Body: WebhookSetupBody }>(
    '/api/config/setup-webhook/sonarr',
    async (request, reply) => {
      const { url, apiKey } = request.body;
      const config = loadConfig();

      // Check external URL is configured
      if (!config.server.externalUrl) {
        return reply.status(400).send({
          success: false,
          error: 'External URL not configured. Set it in Server Settings first.',
        });
      }

      const baseUrl = url.replace(/\/$/, '');
      const webhookUrl = `${config.server.externalUrl}/webhooks/sonarr`;
      const webhookName = 'TextRequest Notifications';

      try {
        // Check if webhook already exists
        const existingResponse = await fetch(`${baseUrl}/api/v3/notification`, {
          headers: { 'X-Api-Key': apiKey },
        });

        if (!existingResponse.ok) {
          return reply.status(400).send({
            success: false,
            error: `Failed to fetch notifications: ${existingResponse.statusText}`,
          });
        }

        const existingNotifications = await existingResponse.json() as ArrNotification[];
        const existing = existingNotifications.find(
          (n) => n.name === webhookName ||
                 (n.implementation === 'Webhook' &&
                  n.fields?.some((f) => f.name === 'url' && String(f.value).includes('/webhooks/sonarr')))
        );

        if (existing) {
          return {
            success: true,
            message: 'Webhook already configured in Sonarr',
            webhookId: existing.id,
          };
        }

        // Generate webhook secret if not set
        if (!config.downloadNotifications.webhookSecret) {
          config.downloadNotifications.webhookSecret = randomUUID();
          saveConfig(config);
        }

        // Create webhook
        const webhookData: ArrNotification = {
          name: webhookName,
          implementation: 'Webhook',
          configContract: 'WebhookSettings',
          onDownload: true,
          onUpgrade: true,
          onImportComplete: true,
          fields: [
            { name: 'url', value: webhookUrl },
            { name: 'method', value: 1 }, // POST
            { name: 'username', value: '' },
            { name: 'password', value: '' },
            { name: 'headers', value: [{ key: 'X-Webhook-Secret', value: config.downloadNotifications.webhookSecret }] },
          ],
        };

        const createResponse = await fetch(`${baseUrl}/api/v3/notification`, {
          method: 'POST',
          headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(webhookData),
        });

        if (createResponse.ok) {
          const created = await createResponse.json() as ArrNotification;
          log.info({ webhookId: created.id }, 'Sonarr webhook created');
          return {
            success: true,
            message: 'Webhook created in Sonarr',
            webhookId: created.id,
          };
        } else {
          const errorText = await createResponse.text();
          log.error({ error: errorText }, 'Failed to create Sonarr webhook');
          return reply.status(400).send({
            success: false,
            error: `Failed to create webhook: ${errorText}`,
          });
        }
      } catch (error) {
        log.error({ error }, 'Error setting up Sonarr webhook');
        return reply.status(500).send({
          success: false,
          error: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }
  );

  // Setup webhook in Radarr
  fastify.post<{ Body: WebhookSetupBody }>(
    '/api/config/setup-webhook/radarr',
    async (request, reply) => {
      const { url, apiKey } = request.body;
      const config = loadConfig();

      // Check external URL is configured
      if (!config.server.externalUrl) {
        return reply.status(400).send({
          success: false,
          error: 'External URL not configured. Set it in Server Settings first.',
        });
      }

      const baseUrl = url.replace(/\/$/, '');
      const webhookUrl = `${config.server.externalUrl}/webhooks/radarr`;
      const webhookName = 'TextRequest Notifications';

      try {
        // Check if webhook already exists
        const existingResponse = await fetch(`${baseUrl}/api/v3/notification`, {
          headers: { 'X-Api-Key': apiKey },
        });

        if (!existingResponse.ok) {
          return reply.status(400).send({
            success: false,
            error: `Failed to fetch notifications: ${existingResponse.statusText}`,
          });
        }

        const existingNotifications = await existingResponse.json() as ArrNotification[];
        const existing = existingNotifications.find(
          (n) => n.name === webhookName ||
                 (n.implementation === 'Webhook' &&
                  n.fields?.some((f) => f.name === 'url' && String(f.value).includes('/webhooks/radarr')))
        );

        if (existing) {
          return {
            success: true,
            message: 'Webhook already configured in Radarr',
            webhookId: existing.id,
          };
        }

        // Generate webhook secret if not set
        if (!config.downloadNotifications.webhookSecret) {
          config.downloadNotifications.webhookSecret = randomUUID();
          saveConfig(config);
        }

        // Create webhook
        const webhookData: ArrNotification = {
          name: webhookName,
          implementation: 'Webhook',
          configContract: 'WebhookSettings',
          onDownload: true,
          onUpgrade: true,
          fields: [
            { name: 'url', value: webhookUrl },
            { name: 'method', value: 1 }, // POST
            { name: 'username', value: '' },
            { name: 'password', value: '' },
            { name: 'headers', value: [{ key: 'X-Webhook-Secret', value: config.downloadNotifications.webhookSecret }] },
          ],
        };

        const createResponse = await fetch(`${baseUrl}/api/v3/notification`, {
          method: 'POST',
          headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(webhookData),
        });

        if (createResponse.ok) {
          const created = await createResponse.json() as ArrNotification;
          log.info({ webhookId: created.id }, 'Radarr webhook created');
          return {
            success: true,
            message: 'Webhook created in Radarr',
            webhookId: created.id,
          };
        } else {
          const errorText = await createResponse.text();
          log.error({ error: errorText }, 'Failed to create Radarr webhook');
          return reply.status(400).send({
            success: false,
            error: `Failed to create webhook: ${errorText}`,
          });
        }
      } catch (error) {
        log.error({ error }, 'Error setting up Radarr webhook');
        return reply.status(500).send({
          success: false,
          error: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }
  );
}
