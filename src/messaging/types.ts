import type { MessageResponse } from '../handlers/message.handler.js';

/**
 * Supported messaging platforms
 */
export type Platform = 'sms' | 'discord' | 'slack' | 'telegram';

/**
 * Platform-agnostic user identifier
 * Format: "platform:id" e.g., "sms:+15551234567", "discord:123456789", "telegram:987654321"
 */
export type PlatformUserId = `${Platform}:${string}`;

/**
 * Parse a PlatformUserId into its components
 */
export function parsePlatformUserId(userId: PlatformUserId): {
  platform: Platform;
  rawId: string;
} {
  const [platform, ...rest] = userId.split(':');
  return {
    platform: platform as Platform,
    rawId: rest.join(':'), // Handle IDs that might contain colons (like phone numbers with country codes)
  };
}

/**
 * Create a PlatformUserId from platform and raw ID
 */
export function createPlatformUserId(platform: Platform, rawId: string): PlatformUserId {
  return `${platform}:${rawId}`;
}

/**
 * Normalized incoming message from any platform
 */
export interface IncomingMessage {
  platform: Platform;
  userId: PlatformUserId;
  rawPlatformId: string;
  text: string;
  timestamp: Date;
  metadata?: {
    channelId?: string;
    guildId?: string;
    workspaceId?: string;
    chatId?: string;
    isDirectMessage?: boolean;
    replyToMessageId?: string;
  };
}

/**
 * Context for sending a response (used by formatters)
 */
export interface ResponseContext {
  userId: PlatformUserId;
  platform: Platform;
  channelId?: string;
  replyToMessageId?: string;
}

/**
 * Messaging provider interface - implemented by each platform adapter
 */
export interface MessagingProvider {
  readonly platform: Platform;
  readonly isEnabled: boolean;

  /**
   * Set the message handler callback for incoming messages
   */
  setMessageHandler(handler: MessageHandlerCallback): void;

  /**
   * Start the provider (connect to platform, start webhook server, etc.)
   */
  start(): Promise<void>;

  /**
   * Stop the provider gracefully
   */
  stop(): Promise<void>;

  /**
   * Send a response to a user
   */
  sendMessage(
    userId: PlatformUserId,
    response: MessageResponse,
    context?: ResponseContext
  ): Promise<void>;
}

/**
 * Message handler callback type
 */
export type MessageHandlerCallback = (
  userId: PlatformUserId,
  message: string
) => Promise<MessageResponse>;

// Re-export MessageResponse for convenience
export type { MessageResponse };
