import { describe, it, expect } from 'vitest';
import {
  getConfigForDisplay,
  preserveSecrets,
  preserveManagedFields,
  AppConfigSchema,
  SECRET_FIELDS,
  MANAGED_SEPARATELY_FIELDS,
} from '../../src/config/storage.js';

/**
 * Helper to get a value at a dot-notation path
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

describe('config preservation', () => {
  /**
   * SECRET_FIELDS is now the single source of truth.
   * To add a new secret:
   * 1. Add it to SECRET_FIELDS in storage.ts
   * 2. That's it! Both masking and preservation use this list.
   */
  it('should mask all fields listed in SECRET_FIELDS', () => {
    // Create a config with values for all secret fields
    const config = AppConfigSchema.parse({
      ai: {
        openaiApiKey: 'sk-test-openai-key-12345',
        anthropicApiKey: 'sk-ant-test-anthropic-key',
        googleApiKey: 'test-google-key-12345',
      },
      twilio: {
        authToken: 'twilio-auth-token-12345',
      },
      telegram: {
        botToken: 'telegram-bot-token-12345',
        webhookSecret: 'telegram-webhook-secret',
      },
      discord: {
        botToken: 'discord-bot-token-12345',
      },
      slack: {
        botToken: 'slack-bot-token-12345',
        signingSecret: 'slack-signing-secret-12345',
        appToken: 'slack-app-token-12345',
      },
      sonarr: {
        apiKey: 'sonarr-api-key-12345',
      },
      radarr: {
        apiKey: 'radarr-api-key-12345',
      },
      tmdb: {
        apiKey: 'tmdb-api-key-12345',
      },
      admin: {
        username: 'admin',
        passwordHash: '$2b$12$hashedpassword',
      },
      downloadNotifications: {
        webhookSecret: 'download-webhook-secret',
      },
    });

    const displayed = getConfigForDisplay(config);

    // Every field in SECRET_FIELDS should be masked
    for (const path of SECRET_FIELDS) {
      const value = getPath(displayed as unknown as Record<string, unknown>, path);
      expect(value, `${path} should be masked`).toMatch(/^(••••|$)/);
    }
  });

  it('should preserve secrets when new config has masked values', () => {
    const existingConfig = AppConfigSchema.parse({
      ai: { openaiApiKey: 'real-secret-key' },
    });

    const newConfig = AppConfigSchema.parse({
      ai: { openaiApiKey: '••••••••-key' }, // Masked value from frontend
    });

    preserveSecrets(newConfig, existingConfig);

    expect(newConfig.ai.openaiApiKey).toBe('real-secret-key');
  });

  it('should preserve secrets when new config has empty values', () => {
    const existingConfig = AppConfigSchema.parse({
      ai: { openaiApiKey: 'real-secret-key' },
    });

    const newConfig = AppConfigSchema.parse({
      ai: { openaiApiKey: '' }, // Empty value
    });

    preserveSecrets(newConfig, existingConfig);

    expect(newConfig.ai.openaiApiKey).toBe('real-secret-key');
  });

  it('should allow updating secrets with new values', () => {
    const existingConfig = AppConfigSchema.parse({
      ai: { openaiApiKey: 'old-key' },
    });

    const newConfig = AppConfigSchema.parse({
      ai: { openaiApiKey: 'new-real-key' }, // New value (not masked)
    });

    preserveSecrets(newConfig, existingConfig);

    expect(newConfig.ai.openaiApiKey).toBe('new-real-key');
  });

  it('should preserve managed fields (users, admin, mediaRequests)', () => {
    const existingConfig = AppConfigSchema.parse({
      users: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test User', identities: { sms: '+1234567890' }, isAdmin: false, createdAt: new Date().toISOString(), requestCount: { movies: 0, tvShows: 0, lastReset: new Date().toISOString() }, notificationPreferences: { enabled: true } }],
      admin: { username: 'admin', passwordHash: '$2b$12$hashedpassword' },
      mediaRequests: [{ id: '550e8400-e29b-41d4-a716-446655440001', mediaType: 'movie', title: 'Test', year: 2024, tmdbId: 123, requestedBy: 'sms:+1234567890', requestedAt: new Date().toISOString(), status: 'pending' }],
    });

    // New config with empty managed fields (simulating frontend not sending them)
    const newConfig = AppConfigSchema.parse({});

    preserveManagedFields(newConfig, existingConfig);

    expect(newConfig.users).toHaveLength(1);
    expect(newConfig.admin.passwordHash).toBe('$2b$12$hashedpassword');
    expect(newConfig.mediaRequests).toHaveLength(1);
  });

  it('should not expose original secret values in display config', () => {
    const secretValue = 'super-secret-value-12345';
    const config = AppConfigSchema.parse({
      ai: { openaiApiKey: secretValue },
    });

    const displayed = getConfigForDisplay(config);

    // The full secret should never appear in the displayed config
    expect(JSON.stringify(displayed)).not.toContain(secretValue);
  });

  it('should have all expected fields in SECRET_FIELDS', () => {
    // This test documents what we expect in SECRET_FIELDS
    // If you add a new secret, add it here too as documentation
    const expectedSecrets = [
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
    ];

    expect([...SECRET_FIELDS].sort()).toEqual(expectedSecrets.sort());
  });

  it('should have all expected fields in MANAGED_SEPARATELY_FIELDS', () => {
    const expectedManaged = ['users', 'admin', 'mediaRequests'];
    expect([...MANAGED_SEPARATELY_FIELDS].sort()).toEqual(expectedManaged.sort());
  });
});
