import type { Logger } from '../utils/logger.js';
import type { MediaSearchResult, ConversationState, SessionData, Platform, ConversationMessage } from '../schemas/index.js';
import type { PlatformUserId } from '../messaging/types.js';
import type { FilteredProwlarrResult } from './prowlarr.service.js';
import { parsePlatformUserId } from '../messaging/types.js';

type ResultSourceType = 'search' | 'recommendation';

/**
 * Session manager for tracking conversation state per user
 */
export class SessionService {
  private readonly sessions: Map<string, SessionData> = new Map();
  private readonly timeoutMs: number;
  private readonly logger: Logger;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(timeoutMs: number, logger: Logger, cleanupIntervalMs = 60000) {
    this.timeoutMs = timeoutMs;
    this.logger = logger.child({ service: 'session' });

    // Clean up expired sessions periodically
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), cleanupIntervalMs);
  }

  /**
   * Get or create a session for a user
   */
  getSession(userId: PlatformUserId): SessionData {
    let session = this.sessions.get(userId);

    if (!session || this.isExpired(session)) {
      session = this.createSession(userId);
      this.sessions.set(userId, session);
      this.logger.debug({ userId }, 'Created new session');
    } else {
      // Update last activity
      session.lastActivity = new Date();
    }

    return session;
  }

  /**
   * Update session state
   */
  setState(userId: PlatformUserId, state: ConversationState): void {
    const session = this.getSession(userId);
    session.state = state;
    session.lastActivity = new Date();
    this.logger.debug({ userId, state }, 'Updated session state');
  }

  /**
   * Atomically update session state with context
   * Prevents race condition where session could expire between separate calls
   */
  setStateWithContext(userId: PlatformUserId, state: ConversationState, context: Record<string, unknown>): void {
    const session = this.getSession(userId);
    session.state = state;
    session.context = { ...session.context, ...context };
    session.lastActivity = new Date();
    this.logger.debug({ userId, state, context }, 'Updated session state with context');
  }

  /**
   * Set pending results for selection
   */
  setPendingResults(userId: PlatformUserId, results: MediaSearchResult[]): void {
    const session = this.getSession(userId);
    session.pendingResults = results;
    session.state = 'awaiting_selection';
    session.lastActivity = new Date();
    this.logger.debug({ userId, resultCount: results.length }, 'Set pending results');
  }

  /**
   * Set selected media for confirmation
   */
  setSelectedMedia(userId: PlatformUserId, media: MediaSearchResult): void {
    const session = this.getSession(userId);
    session.selectedMedia = media;
    session.state = 'awaiting_confirmation';
    session.lastActivity = new Date();
    this.logger.debug({ userId, title: media.title }, 'Set selected media');
  }

  /**
   * Get pending results
   */
  getPendingResults(userId: PlatformUserId): MediaSearchResult[] {
    return this.getSession(userId).pendingResults;
  }

  /**
   * Store Prowlarr search results for user selection
   */
  setProwlarrResults(
    userId: PlatformUserId,
    results: FilteredProwlarrResult[],
    context?: Record<string, unknown>
  ): void {
    const session = this.getSession(userId);
    session.prowlarrResults = results as SessionData['prowlarrResults'];
    session.context = context ? { ...session.context, ...context } : { ...session.context, prowlarrBulkChoices: undefined };
    session.state = 'awaiting_prowlarr_selection';
    session.lastActivity = new Date();
    this.logger.debug({ userId, resultCount: results.length }, 'Set Prowlarr results');
  }

  /**
   * Get Prowlarr search results
   */
  getProwlarrResults(userId: PlatformUserId): SessionData['prowlarrResults'] {
    return this.getSession(userId).prowlarrResults;
  }

  /**
   * Get selected media
   */
  getSelectedMedia(userId: PlatformUserId): MediaSearchResult | null {
    return this.getSession(userId).selectedMedia;
  }

  /**
   * Reset session to idle state
   * Preserves recentMessages for context, clears everything else
   */
  resetSession(userId: PlatformUserId): void {
    const session = this.getSession(userId);
    session.state = 'idle';
    session.pendingResults = [];
    session.prowlarrResults = [];
    session.selectedMedia = null;
    session.resultSource = null;
    session.context = {};
    session.lastActivity = new Date();
    // Note: recentMessages is preserved for context
    this.logger.debug({ userId }, 'Reset session');
  }

  /**
   * Add a message to conversation history (keeps last 10)
   */
  addMessage(userId: PlatformUserId, role: 'user' | 'assistant', content: string): void {
    const session = this.getSession(userId);
    session.recentMessages.push({ role, content });
    // Keep only last 10 messages
    if (session.recentMessages.length > 10) {
      session.recentMessages.shift();
    }
    session.lastActivity = new Date();
  }

  /**
   * Get recent messages for AI context
   */
  getRecentMessages(userId: PlatformUserId): ConversationMessage[] {
    return this.getSession(userId).recentMessages;
  }

  /**
   * Remove a specific item from pending results
   */
  removeFromPendingResults(userId: PlatformUserId, mediaId: number): void {
    const session = this.getSession(userId);
    session.pendingResults = session.pendingResults.filter(r => r.id !== mediaId);
    session.lastActivity = new Date();
    this.logger.debug({ userId, mediaId, remaining: session.pendingResults.length }, 'Removed from pending results');
  }

  /**
   * Set the source of current results
   */
  setResultSource(userId: PlatformUserId, source: ResultSourceType): void {
    const session = this.getSession(userId);
    session.resultSource = source;
    session.lastActivity = new Date();
    this.logger.debug({ userId, source }, 'Set result source');
  }

  /**
   * Get the source of current results
   */
  getResultSource(userId: PlatformUserId): ResultSourceType | null {
    return this.getSession(userId).resultSource;
  }

  /**
   * Delete a session
   */
  deleteSession(userId: PlatformUserId): void {
    this.sessions.delete(userId);
    this.logger.debug({ userId }, 'Deleted session');
  }

  /**
   * Create a new session
   */
  private createSession(userId: PlatformUserId): SessionData {
    const { platform } = parsePlatformUserId(userId);
    return {
      userId,
      platform: platform as Platform,
      state: 'idle',
      pendingResults: [],
      selectedMedia: null,
      lastActivity: new Date(),
      context: {},
      recentMessages: [],
      resultSource: null,
      prowlarrResults: [],
    };
  }

  /**
   * Check if a session has expired
   */
  private isExpired(session: SessionData): boolean {
    const elapsed = Date.now() - session.lastActivity.getTime();
    return elapsed > this.timeoutMs;
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpired(): void {
    let cleaned = 0;
    for (const [userId, session] of this.sessions) {
      if (this.isExpired(session)) {
        this.sessions.delete(userId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug({ cleaned }, 'Cleaned up expired sessions');
    }
  }

  /**
   * Stop the cleanup interval (for graceful shutdown)
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
