import type { Logger } from '../utils/logger.js';
import type {
  Platform,
  PlatformUserId,
  MessagingProvider,
  MessageHandlerCallback,
  MessageResponse,
} from './types.js';

/**
 * MessagingManager orchestrates all messaging providers
 */
export class MessagingManager {
  private readonly providers: Map<Platform, MessagingProvider> = new Map();
  private readonly logger: Logger;
  private messageHandler?: MessageHandlerCallback;

  constructor(logger: Logger) {
    this.logger = logger.child({ service: 'messaging' });
  }

  /**
   * Set the message handler callback and propagate to all registered providers
   */
  setMessageHandler(handler: MessageHandlerCallback): void {
    this.messageHandler = handler;
    for (const provider of this.providers.values()) {
      provider.setMessageHandler(handler);
    }
  }

  /**
   * Register a messaging provider
   */
  registerProvider(provider: MessagingProvider): void {
    if (this.providers.has(provider.platform)) {
      this.logger.warn({ platform: provider.platform }, 'Provider already registered, replacing');
    }
    this.providers.set(provider.platform, provider);
    // Propagate existing handler to newly registered provider
    if (this.messageHandler) {
      provider.setMessageHandler(this.messageHandler);
    }
    this.logger.info({ platform: provider.platform }, 'Provider registered');
  }

  /**
   * Get a provider by platform
   */
  getProvider(platform: Platform): MessagingProvider | undefined {
    return this.providers.get(platform);
  }

  /**
   * Get all enabled providers
   */
  getEnabledProviders(): MessagingProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.isEnabled);
  }

  /**
   * Start all enabled providers
   */
  async start(): Promise<void> {
    const enabledProviders = this.getEnabledProviders();
    this.logger.info({ count: enabledProviders.length }, 'Starting messaging providers');

    await Promise.all(
      enabledProviders.map(async (provider) => {
        try {
          await provider.start();
          this.logger.info({ platform: provider.platform }, 'Provider started');
        } catch (error) {
          this.logger.error({ error, platform: provider.platform }, 'Failed to start provider');
        }
      })
    );
  }

  /**
   * Stop all providers
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping messaging providers');

    await Promise.all(
      Array.from(this.providers.values()).map(async (provider) => {
        try {
          await provider.stop();
          this.logger.info({ platform: provider.platform }, 'Provider stopped');
        } catch (error) {
          this.logger.error({ error, platform: provider.platform }, 'Failed to stop provider');
        }
      })
    );
  }

  /**
   * Handle an incoming message from any provider
   */
  async handleMessage(userId: PlatformUserId, message: string): Promise<MessageResponse> {
    if (!this.messageHandler) {
      this.logger.error('No message handler set');
      return { text: 'Service not available' };
    }

    return await this.messageHandler(userId, message);
  }

  /**
   * Send a message to a user via their platform
   */
  async sendMessage(
    userId: PlatformUserId,
    response: MessageResponse
  ): Promise<void> {
    const [platform] = userId.split(':') as [Platform];
    const provider = this.providers.get(platform);

    if (!provider) {
      this.logger.error({ userId, platform }, 'No provider for platform');
      return;
    }

    if (!provider.isEnabled) {
      this.logger.warn({ userId, platform }, 'Provider is disabled');
      return;
    }

    await provider.sendMessage(userId, response);
  }
}
