import { generateObject, NoObjectGeneratedError } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import type { Logger } from '../utils/logger.js';
import { AIParseError, AIQuotaError } from '../utils/errors.js';
import type { ParsedRequest, ConversationState, MediaSearchResult, ConversationMessage } from '../schemas/index.js';

/**
 * Session context for AI parsing
 * Provides information about the current conversation state
 */
export interface AISessionContext {
  state: ConversationState;
  pendingResults?: MediaSearchResult[];
  selectedMedia?: MediaSearchResult | null;
  recentMessages?: ConversationMessage[];
}

export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'google';
  model: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  temperature?: number;
  responseStyle?: 'brief' | 'standard' | 'detailed';
  systemPrompt?: string;
}

/**
 * Schema for AI response
 *
 * Best practices from AI SDK v5:
 * - Use .nullable() instead of .optional() for OpenAI structured outputs
 * - Use .describe() to provide hints to the model
 *
 * Note: media_type is NOT included here - TMDB multi-search determines the type.
 * This simplifies the AI's job to just extracting the title and action.
 */
const AIResponseSchema = z.object({
  title: z
    .string()
    .nullable()
    .describe('The extracted media title, cleaned of phrases like "the movie" or "the show" or "anime"'),
  year: z.number().nullable().describe('Release year if explicitly mentioned in the request'),
  action: z
    .enum([
      'add',
      'search',
      'status',
      'help',
      'confirm',
      'cancel',
      'select',
      'anime_confirm',
      'regular_confirm',
      'season_select',
      'back',
      'show_context',
      'restart',
      'change_selection',
      'decline',
      'continue',
      'recommend',
      // Media info actions
      'get_cast',
      'get_trailer',
      'where_to_watch',
      'get_details',
      'get_content_rating',
      'get_reviews',
      'get_collection',
      'next_episode',
      'box_office',
      // Book/Comic search
      'search_book',
      'search_comic',
    ])
    .describe(
      'The action based on message and context. Conversational actions: confirm (yes), cancel (no), select (number), back, restart, show_context, change_selection, decline (ending conversation), continue (wants to add more). Media actions: add (movie/show to library), search, status, help, recommend. Anime: anime_confirm, regular_confirm. Season: season_select. Recommendations: recommend. Media info: get_cast, get_trailer, where_to_watch, get_details, get_content_rating, get_reviews, get_collection, next_episode, box_office. Book/Comic search: search_book (find books, e-books, audiobooks), search_comic (find comics, manga, graphic novels). Use these for any book/comic/manga requests even if user says "add" - the system does not maintain a book library, it searches Prowlarr.'
    ),
  selectionNumber: z
    .number()
    .nullable()
    .describe('The number the user selected (1-based), for select, change_selection, or season_select actions'),
  isAnimeRequest: z
    .boolean()
    .describe('True if user explicitly mentions "anime" in their request'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence score: 0.9-1.0 for clear requests, 0.5-0.7 for ambiguous'),
  // Recommendation fields
  recommendationType: z
    .enum([
      'trending',
      'popular',
      'top_rated',
      'new_releases',
      'upcoming',
      'airing_today',
      'genre',
      'similar',
      'keyword',
      'by_year',
      'by_provider',
      'by_network',
    ])
    .nullable()
    .describe('Type of recommendation when action is recommend. trending=hot now, popular=widely watched, top_rated=highest rated, new_releases=recent, upcoming=coming soon, airing_today=TV on today, genre=by genre, similar=like another title, keyword=by theme, by_year=from specific year/decade, by_provider=on streaming service, by_network=by TV network'),
  recommendationGenre: z
    .string()
    .nullable()
    .describe('Genre for recommendation (action, comedy, horror, sci-fi, drama, thriller, romance, documentary, animation, fantasy, mystery, crime, western, war, family, history, music). Normalize variants like "sci fi" to "science_fiction".'),
  similarToTitle: z
    .string()
    .nullable()
    .describe('Title to find similar content for, when recommendationType is similar'),
  preferredMediaType: z
    .enum(['movie', 'tv_show', 'any'])
    .nullable()
    .describe('User preference for movies vs TV shows in recommendations'),
  recommendationKeyword: z
    .string()
    .nullable()
    .describe('Thematic keyword for keyword-based recommendations (e.g., "time travel", "zombies", "heist", "superhero")'),
  recommendationYear: z
    .number()
    .nullable()
    .describe('Specific year for by_year recommendations'),
  recommendationDecade: z
    .string()
    .nullable()
    .describe('Decade for by_year recommendations (e.g., "80s", "90s", "2000s", "2010s")'),
  recommendationMinRating: z
    .number()
    .nullable()
    .describe('Minimum rating filter (e.g., 7.5 for "highly rated")'),
  recommendationProvider: z
    .string()
    .nullable()
    .describe('Streaming provider name (e.g., "Netflix", "HBO Max", "Amazon Prime", "Disney+", "Hulu")'),
  recommendationNetwork: z
    .string()
    .nullable()
    .describe('TV network name (e.g., "HBO", "AMC", "NBC", "ABC", "Netflix", "FX")'),
});

/**
 * Get the default system prompt (base template without context-specific parts)
 * This is exported so it can be shown in the UI for editing
 */
export function getDefaultSystemPrompt(): string {
  return `You are a conversational media request parser for a home media server bot (SMS-based).
Parse user messages naturally based on context to determine the action and extract relevant info.

GUIDELINES FOR ALL STATES:

Title extraction:
- Remove "the movie", "the show", "TV series", "film", "anime"
- Keep articles like "The" if part of title
- Keep sequel indicators like "Part 2", "Vol. 2"

Year extraction:
- Extract 4-digit years if mentioned (e.g., "Dune 2021" → year: 2021)
- Don't treat part numbers as years

isAnimeRequest:
- True only if user explicitly says "anime" in request

Confidence:
- 0.9-1.0: Clear request
- 0.7-0.9: Likely correct but some ambiguity
- 0.5-0.7: Significant ambiguity
- Below 0.5: Very uncertain

RECOMMENDATION REQUESTS:
When user asks for suggestions, recommendations, or what to watch, use action: recommend

Core types:
- "What's trending?" → action: recommend, recommendationType: trending
- "What's popular?" → action: recommend, recommendationType: popular
- "Best rated shows" → action: recommend, recommendationType: top_rated, preferredMediaType: tv_show
- "What's new?" / "Any new movies?" → action: recommend, recommendationType: new_releases
- "What's coming out?" / "Upcoming movies" → action: recommend, recommendationType: upcoming
- "What's on TV today?" → action: recommend, recommendationType: airing_today

Genre-based:
- "Recommend a horror movie" → action: recommend, recommendationType: genre, recommendationGenre: horror, preferredMediaType: movie
- "Comedy shows" → action: recommend, recommendationType: genre, recommendationGenre: comedy, preferredMediaType: tv_show
- "I want a sci-fi movie" → action: recommend, recommendationType: genre, recommendationGenre: science_fiction, preferredMediaType: movie

Similar to:
- "Something like Breaking Bad" → action: recommend, recommendationType: similar, similarToTitle: "Breaking Bad"
- "Movies like Inception" → action: recommend, recommendationType: similar, similarToTitle: "Inception", preferredMediaType: movie

Keyword/theme:
- "Movies about time travel" → action: recommend, recommendationType: keyword, recommendationKeyword: "time travel", preferredMediaType: movie
- "Zombie shows" → action: recommend, recommendationType: keyword, recommendationKeyword: "zombie", preferredMediaType: tv_show

Year/era:
- "80s horror movies" → action: recommend, recommendationType: genre, recommendationGenre: horror, recommendationDecade: "80s", preferredMediaType: movie
- "Movies from 2024" → action: recommend, recommendationType: by_year, recommendationYear: 2024, preferredMediaType: movie

Provider/network:
- "What's good on Netflix?" → action: recommend, recommendationType: by_provider, recommendationProvider: "Netflix"
- "HBO shows" → action: recommend, recommendationType: by_network, recommendationNetwork: "HBO", preferredMediaType: tv_show

Combined filters:
- "Highly rated comedies" → action: recommend, recommendationType: genre, recommendationGenre: comedy, recommendationMinRating: 7.5
- "New horror movies from 2024" → action: recommend, recommendationType: genre, recommendationGenre: horror, recommendationYear: 2024, preferredMediaType: movie

Genre normalization (use these values):
action, adventure, animation, comedy, crime, documentary, drama, family, fantasy, history, horror, music, mystery, romance, science_fiction, thriller, war, western

Examples for media requests (not recommendations):
- "Add Breaking Bad" → action: add, title: "Breaking Bad", confidence: 0.95
- "Download Dune 2021" → action: add, title: "Dune", year: 2021, confidence: 0.95
- "Add Attack on Titan anime" → action: add, title: "Attack on Titan", isAnimeRequest: true
- "Is anything downloading?" → action: status
- "help" → action: help

MEDIA INFO REQUESTS:
When user asks for information ABOUT media (not adding it), use these actions:

Cast & Crew (get_cast):
- "Who's in this movie?" → action: get_cast (uses selected media)
- "Who stars in Breaking Bad?" → action: get_cast, title: "Breaking Bad"
- "Who directed Inception?" → action: get_cast, title: "Inception"
- "Cast of The Office" → action: get_cast, title: "The Office"

Trailer (get_trailer):
- "Show me the trailer" → action: get_trailer (uses selected media)
- "Trailer for Dune" → action: get_trailer, title: "Dune"
- "Watch the trailer" → action: get_trailer

Streaming/Where to Watch (where_to_watch):
- "Where can I watch this?" → action: where_to_watch
- "Is it on Netflix?" → action: where_to_watch
- "What streaming services have Breaking Bad?" → action: where_to_watch, title: "Breaking Bad"
- "Can I stream this?" → action: where_to_watch

Details/Synopsis (get_details):
- "Tell me about Inception" → action: get_details, title: "Inception"
- "What's this movie about?" → action: get_details
- "More info" → action: get_details
- "Synopsis" → action: get_details

Content Rating (get_content_rating):
- "What's it rated?" → action: get_content_rating
- "Is this appropriate for kids?" → action: get_content_rating
- "Age rating for Deadpool" → action: get_content_rating, title: "Deadpool"
- "Is this family friendly?" → action: get_content_rating

Reviews/Ratings (get_reviews):
- "Is it good?" → action: get_reviews
- "What do people think of this?" → action: get_reviews
- "Reviews for The Batman" → action: get_reviews, title: "The Batman"
- "Should I watch this?" → action: get_reviews

Collection/Franchise (get_collection) - for movies only:
- "What other movies are in this series?" → action: get_collection
- "Is there a sequel?" → action: get_collection
- "Movies in this collection" → action: get_collection

Next Episode (next_episode) - for TV shows only:
- "When's the next episode?" → action: next_episode
- "When does the next season start?" → action: next_episode
- "Is this show still running?" → action: next_episode
- "When does Stranger Things come back?" → action: next_episode, title: "Stranger Things"

Box Office (box_office) - for movies only:
- "How much did it make?" → action: box_office
- "Box office for Avatar" → action: box_office, title: "Avatar"
- "Was it successful?" → action: box_office
- "Budget for this movie" → action: box_office

BOOK & COMIC SEARCH:
When user asks for books, e-books, audiobooks, comics, manga, or graphic novels, use these actions.
The system searches Prowlarr (an indexer) - not a library. Do NOT use action: add for books/comics.

Book examples (search_book):
- "I want the book Dune" → action: search_book, title: "Dune", confidence: 0.95
- "Find me Die Bibel" → action: search_book, title: "Die Bibel", confidence: 0.95
- "Download the audiobook of Harry Potter" → action: search_book, title: "Harry Potter", confidence: 0.9
- "Search for Stephen King books" → action: search_book, title: "Stephen King", confidence: 0.85
- "Gibt es das Buch Der Herr der Ringe?" → action: search_book, title: "Der Herr der Ringe", confidence: 0.9
- "e-book: The Witcher" → action: search_book, title: "The Witcher", confidence: 0.85

Comic/Manga examples (search_comic):
- "Find the comic Watchmen" → action: search_comic, title: "Watchmen", confidence: 0.95
- "Manga One Piece" → action: search_comic, title: "One Piece", confidence: 0.9
- "Add the graphic novel Maus" → action: search_comic, title: "Maus", confidence: 0.9
- "I want to download Naruto manga" → action: search_comic, title: "Naruto", confidence: 0.9
- "Comic: The Walking Dead" → action: search_comic, title: "The Walking Dead", confidence: 0.9

Note: Admin commands (admin add/remove/list/etc.) are handled separately.`;
}

/**
 * Build context-aware system prompt for parsing media requests
 *
 * The prompt changes based on session state to interpret messages naturally.
 * If a custom systemPrompt is provided in config, it replaces the default.
 */
function buildSystemPrompt(context?: AISessionContext, config?: AIConfig): string {
  // Use custom system prompt if provided, otherwise use default
  const basePrompt = config?.systemPrompt?.trim() || getDefaultSystemPrompt();

  // Add response style instructions
  let prompt = '';
  if (config?.responseStyle === 'brief') {
    prompt += 'IMPORTANT: Keep all responses very short and concise. Use minimal text.\n\n';
  } else if (config?.responseStyle === 'detailed') {
    prompt += 'IMPORTANT: Provide detailed responses with additional context when helpful.\n\n';
  }

  prompt += basePrompt;

  // Add current session state
  prompt += `\n\nCURRENT SESSION STATE: ${context?.state || 'idle'}
`;

  // Add context-specific instructions
  if (context?.state === 'awaiting_selection' && context.pendingResults) {
    const resultsList = context.pendingResults
      .map((r, i) => `${i + 1}. ${r.title}${r.year ? ` (${r.year})` : ''} - ${r.mediaType === 'movie' ? 'Movie' : 'TV Show'}`)
      .join('\n');
    prompt += `
The user is choosing from these search results:
${resultsList}

Interpret their response:
- A number (1-${context.pendingResults.length}) → action: select, selectionNumber: that number
- "the first one", "number 2", "second" → action: select, selectionNumber: the number they mean
- A new media title → action: add, title: the new title (they want to search for something else)
- "cancel", "nevermind" → action: cancel
- "help" → action: help
`;
  } else if (context?.state === 'awaiting_confirmation' && context.selectedMedia) {
    const media = context.selectedMedia;
    prompt += `
The user is confirming whether to add: "${media.title}"${media.year ? ` (${media.year})` : ''}

Interpret their response:
- Affirmative (yes, yeah, yep, sure, ok, do it) → action: confirm
- Negative (no, nope, cancel, nevermind) → action: cancel
- "back", "go back", "different one" → action: back (return to selection)
- A number → action: change_selection, selectionNumber: that number (pick different from list)
- "actually the first one", "I meant 2" → action: change_selection, selectionNumber: the number
- A new media title → action: add, title: the new title
`;
  } else if (context?.state === 'awaiting_anime_confirmation' && context.selectedMedia) {
    const media = context.selectedMedia;
    prompt += `
The user needs to confirm if "${media.title}" is anime or regular content.

Interpret their response:
- "anime", "a", "yes it's anime" → action: anime_confirm
- "regular", "r", "normal", "not anime", "no" → action: regular_confirm
- "cancel", "nevermind" → action: cancel
- "back" → action: back
`;
  } else if (context?.state === 'awaiting_season_selection' && context.selectedMedia) {
    const media = context.selectedMedia;
    prompt += `
The user is selecting which seasons to monitor for: "${media.title}"
Options: 1=All seasons, 2=First season, 3=Latest season, 4=Future seasons

Interpret their response:
- "1", "all", "all seasons", "yes" → action: season_select, selectionNumber: 1
- "2", "first", "first season" → action: season_select, selectionNumber: 2
- "3", "latest", "last", "newest" → action: season_select, selectionNumber: 3
- "4", "future", "new episodes" → action: season_select, selectionNumber: 4
- "cancel", "nevermind" → action: cancel
- "back" → action: back
`;
  } else {
    // idle state - standard media request parsing
    prompt += `
The user is starting a new request.

Interpret their response:
- Media request (add, download, get, watch + title) → action: add, title: extracted title
- Search request (search, find, look up) → action: search, title: extracted title
- Status check (status, downloading, progress, queue) → action: status
- Help request (help, commands, what can you do) → action: help
- "where am I", "what's happening", "context" → action: show_context
- "start over", "reset", "clear" → action: restart
- Declining/ending (no, no thanks, nope, I'm good, that's all, thanks, thank you, goodbye) → action: decline
- Wanting to continue without specifying title (yes, yeah, sure, yep, ok) → action: continue
`;
  }

  // Add recent conversation history for context
  if (context?.recentMessages?.length) {
    const recentHistory = context.recentMessages
      .slice(-5) // Last 5 messages
      .map(m => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}`)
      .join('\n');
    prompt += `
RECENT CONVERSATION (for context):
${recentHistory}

Use this context to understand references like "the others", "that one", "the first option", etc.
`;
  }

  return prompt;
}

/**
 * AI service for parsing natural language media requests
 *
 * Uses Vercel AI SDK v5 best practices:
 * - Custom provider instances with explicit API keys
 * - Proper error handling with NoObjectGeneratedError
 * - Schema descriptions for better model guidance
 * - Support for OpenAI, Anthropic, and Google Gemini
 */
export class AIService {
  private readonly logger: Logger;
  private readonly config: AIConfig;
  private readonly provider: 'openai' | 'anthropic' | 'google';
  private readonly modelId: string;
  private readonly openaiClient: ReturnType<typeof createOpenAI> | null;
  private readonly anthropicClient: ReturnType<typeof createAnthropic> | null;
  private readonly googleClient: ReturnType<typeof createGoogleGenerativeAI> | null;

  constructor(config: AIConfig, logger: Logger) {
    this.logger = logger.child({ service: 'ai' });
    this.config = config;
    this.provider = config.provider;
    this.modelId = config.model;

    // Initialize provider clients with explicit API keys (best practice)
    this.openaiClient = null;
    this.anthropicClient = null;
    this.googleClient = null;

    switch (config.provider) {
      case 'openai':
        if (!config.openaiApiKey) {
          throw new AIParseError('OpenAI API key is required');
        }
        this.openaiClient = createOpenAI({
          apiKey: config.openaiApiKey,
        });
        break;

      case 'anthropic':
        if (!config.anthropicApiKey) {
          throw new AIParseError('Anthropic API key is required');
        }
        this.anthropicClient = createAnthropic({
          apiKey: config.anthropicApiKey,
        });
        break;

      case 'google':
        if (!config.googleApiKey) {
          throw new AIParseError('Google API key is required');
        }
        this.googleClient = createGoogleGenerativeAI({
          apiKey: config.googleApiKey,
        });
        break;

      default:
        throw new AIParseError(`Unsupported AI provider: ${config.provider as string}`);
    }

    this.logger.info({ provider: config.provider, model: config.model }, 'AI service initialized');
  }

  /**
   * Get the appropriate model based on provider
   * Uses custom provider instances for explicit API key management
   */
  private getModel() {
    if (this.provider === 'openai' && this.openaiClient) {
      return this.openaiClient(this.modelId);
    } else if (this.provider === 'anthropic' && this.anthropicClient) {
      return this.anthropicClient(this.modelId);
    } else if (this.provider === 'google' && this.googleClient) {
      return this.googleClient(this.modelId);
    }
    throw new AIParseError('No AI provider configured');
  }

  /**
   * Parse a user message into a structured request
   *
   * Uses AI SDK v5 best practices:
   * - schemaName and schemaDescription for better model guidance
   * - Proper error handling with NoObjectGeneratedError
   * - Token usage logging for cost monitoring
   *
   * @param message The user's message
   * @param context Optional session context for natural conversation flow
   */
  async parseMessage(message: string, context?: AISessionContext): Promise<ParsedRequest> {
    this.logger.debug({ message, context: context?.state }, 'Parsing message');

    // Handle admin commands first (no AI call needed)
    const adminCommand = this.parseAdminCommand(message);
    if (adminCommand) {
      return adminCommand;
    }

    try {
      const systemPrompt = buildSystemPrompt(context, this.config);

      // Google recommends keeping temperature at 1.0 for Gemini 3 models
      // to avoid looping/degraded performance. For other providers, use configured value.
      const temperature = this.provider === 'google' && this.modelId.includes('gemini-3')
        ? 1.0
        : (this.config.temperature ?? 0.2);

      const { object, usage } = await generateObject({
        model: this.getModel(),
        schemaName: 'MediaRequest',
        schemaDescription: 'A parsed media request from a user message for a home media server bot',
        schema: AIResponseSchema,
        system: systemPrompt,
        prompt: `Parse this user message: "${message}"`,
        temperature,
        maxOutputTokens: 512, // Schema is small, limit tokens for cost control
      });

      // Log token usage for cost monitoring
      this.logger.debug(
        {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
        },
        'AI token usage'
      );

      const result: ParsedRequest = {
        mediaType: object.preferredMediaType === 'movie' ? 'movie'
          : object.preferredMediaType === 'tv_show' ? 'tv_show'
          : 'unknown',
        title: object.title,
        year: object.year,
        action: object.action,
        selectionNumber: object.selectionNumber,
        confidence: object.confidence,
        rawMessage: message,
        isAnimeRequest: object.isAnimeRequest,
        // Add recommendation parameters when action is recommend
        recommendationParams: object.action === 'recommend' ? {
          type: object.recommendationType ?? 'popular',
          mediaType: object.preferredMediaType ?? 'any',
          genre: object.recommendationGenre ?? null,
          similarTo: object.similarToTitle ?? null,
          timeWindow: null,
          keyword: object.recommendationKeyword ?? null,
          year: object.recommendationYear ?? null,
          decade: object.recommendationDecade ?? null,
          minRating: object.recommendationMinRating ?? null,
          provider: object.recommendationProvider ?? null,
          network: object.recommendationNetwork ?? null,
        } : undefined,
      };

      this.logger.info({ message, result, state: context?.state }, 'Message parsed');
      return result;
    } catch (error) {
      // Handle specific AI SDK errors (best practice)
      if (NoObjectGeneratedError.isInstance(error)) {
        this.logger.error(
          {
            cause: error.cause,
            text: error.text,
            finishReason: error.finishReason,
            usage: error.usage,
            message,
          },
          'AI failed to generate valid object'
        );

        // Return a fallback response for graceful degradation
        return {
          mediaType: 'unknown',
          title: message, // Use raw message as title fallback
          year: null,
          action: 'add',
          selectionNumber: null,
          confidence: 0.3,
          rawMessage: message,
          isAnimeRequest: false,
        };
      }

      if (isAIQuotaError(error)) {
        const retryAfter = getRetryAfterMessage(error);
        this.logger.warn({ error, message, retryAfter }, 'AI quota or rate limit exceeded');
        throw new AIQuotaError(retryAfter ? `Quota exceeded. Retry ${retryAfter}.` : 'Quota exceeded. Please retry later.');
      }

      this.logger.error({ error, message }, 'Failed to parse message');
      throw new AIParseError(`Failed to parse message: ${String(error)}`);
    }
  }

  /**
   * Normalize phone number - strip special characters and auto-prepend +1 if no country code
   */
  private normalizePhoneNumber(phone: string): string {
    // Strip all non-digit characters except leading +
    const hasCountryCode = phone.startsWith('+');
    const digits = phone.replace(/\D/g, '');

    if (hasCountryCode) {
      return '+' + digits;
    }
    // Auto-prepend +1 (US default)
    return '+1' + digits;
  }

  /**
   * Parse platform target from input like "telegram:123456789" or "5551234567"
   * Returns platform and ID, defaulting to SMS for bare phone numbers
   */
  private parsePlatformTarget(input: string): { platform: 'sms' | 'telegram' | 'discord' | 'slack'; id: string } {
    const validPlatforms = ['sms', 'telegram', 'discord', 'slack'] as const;

    // Check for platform:id format
    const colonIndex = input.indexOf(':');
    if (colonIndex > 0) {
      const platformPart = input.slice(0, colonIndex).toLowerCase();
      const idPart = input.slice(colonIndex + 1);

      if (validPlatforms.includes(platformPart as typeof validPlatforms[number])) {
        // For SMS, normalize the phone number
        if (platformPart === 'sms') {
          return { platform: 'sms', id: this.normalizePhoneNumber(idPart) };
        }
        return { platform: platformPart as typeof validPlatforms[number], id: idPart };
      }
    }

    // Default: treat as SMS phone number (backwards compatibility)
    return { platform: 'sms', id: this.normalizePhoneNumber(input) };
  }

  /**
   * Parse admin commands without calling AI
   */
  private parseAdminCommand(message: string): ParsedRequest | null {
    const normalized = message.toLowerCase().trim();

    // Check if it's an admin command (either "admin" alone or "admin <subcommand>")
    if (normalized !== 'admin' && !normalized.startsWith('admin ')) {
      return null;
    }

    const parts = message.trim().split(/\s+/);
    const subCommand = parts[1]?.toLowerCase();

    // admin (by itself) or "admin help" - show admin help
    if (!subCommand || subCommand === 'help') {
      return {
        mediaType: 'unknown',
        title: null,
        year: null,
        action: 'admin_help',
        selectionNumber: null,
        confidence: 1.0,
        rawMessage: message,
      };
    }

    // admin list
    if (subCommand === 'list') {
      return {
        mediaType: 'unknown',
        title: null,
        year: null,
        action: 'admin_list',
        selectionNumber: null,
        confidence: 1.0,
        rawMessage: message,
      };
    }

    // admin add <platform:id|phone> <name> (e.g., "admin add telegram:123456 John" or "admin add 5551234567 John")
    if (subCommand === 'add' && parts.length >= 4) {
      const { platform, id } = this.parsePlatformTarget(parts[2]!);
      const userName = parts.slice(3).join(' ');
      return {
        mediaType: 'unknown',
        title: null,
        year: null,
        action: 'admin_add',
        selectionNumber: null,
        confidence: 1.0,
        rawMessage: message,
        adminCommand: {
          targetPlatform: platform,
          targetId: id,
          userName,
        },
      };
    }

    // admin remove <platform:id|phone> (e.g., "admin remove telegram:123456" or "admin remove 5551234567")
    if (subCommand === 'remove' && parts.length >= 3) {
      const { platform, id } = this.parsePlatformTarget(parts[2]!);
      return {
        mediaType: 'unknown',
        title: null,
        year: null,
        action: 'admin_remove',
        selectionNumber: null,
        confidence: 1.0,
        rawMessage: message,
        adminCommand: {
          targetPlatform: platform,
          targetId: id,
        },
      };
    }

    // admin promote <platform:id|phone>
    if (subCommand === 'promote' && parts.length >= 3) {
      const { platform, id } = this.parsePlatformTarget(parts[2]!);
      return {
        mediaType: 'unknown',
        title: null,
        year: null,
        action: 'admin_promote',
        selectionNumber: null,
        confidence: 1.0,
        rawMessage: message,
        adminCommand: {
          targetPlatform: platform,
          targetId: id,
        },
      };
    }

    // admin demote <platform:id|phone>
    if (subCommand === 'demote' && parts.length >= 3) {
      const { platform, id } = this.parsePlatformTarget(parts[2]!);
      return {
        mediaType: 'unknown',
        title: null,
        year: null,
        action: 'admin_demote',
        selectionNumber: null,
        confidence: 1.0,
        rawMessage: message,
        adminCommand: {
          targetPlatform: platform,
          targetId: id,
        },
      };
    }

    // admin quota <platform:id|phone> <type> <amount>
    if (subCommand === 'quota' && parts.length >= 5) {
      const { platform, id } = this.parsePlatformTarget(parts[2]!);
      const mediaType = parts[3]?.toLowerCase() === 'tv' || parts[3]?.toLowerCase() === 'tvshows' || parts[3]?.toLowerCase() === 'tv_show'
        ? 'tv_show' as const
        : 'movie' as const;
      const amount = parseInt(parts[4]!, 10);

      // Validate amount is a number within reasonable bounds (-1000 to 1000)
      if (!isNaN(amount) && amount >= -1000 && amount <= 1000) {
        return {
          mediaType: 'unknown',
          title: null,
          year: null,
          action: 'admin_quota',
          selectionNumber: null,
          confidence: 1.0,
          rawMessage: message,
          adminCommand: {
            targetPlatform: platform,
            targetId: id,
            mediaType,
            quotaAmount: amount,
          },
        };
      }
    }

    return null;
  }

}

function isAIQuotaError(error: unknown): boolean {
  const values = collectErrorValues(error);
  return values.some((value) => {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return record.statusCode === 429 ||
      record.status === 429 ||
      record.reason === 'maxRetriesExceeded' && collectErrorValues(record.errors).some(isAIQuotaError) ||
      String(record.name ?? '').includes('RateLimit') ||
      String(record.message ?? '').toLowerCase().includes('quota exceeded') ||
      String(record.message ?? '').toLowerCase().includes('resource_exhausted') ||
      String(record.responseBody ?? '').toLowerCase().includes('quota exceeded') ||
      String(record.responseBody ?? '').toLowerCase().includes('resource_exhausted');
  });
}

function getRetryAfterMessage(error: unknown): string | null {
  const values = collectErrorValues(error);
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const text = `${String((value as Record<string, unknown>).message ?? '')}\n${String((value as Record<string, unknown>).responseBody ?? '')}`;
    const retryMatch = text.match(/retry(?:\s+in|\s+after)?\s+([\d.]+)\s*(ms|s|sec|seconds|m|min|minutes)?/i);
    if (retryMatch?.[1]) {
      const unit = retryMatch[2] ?? 'seconds';
      return `in ${retryMatch[1]} ${unit}`;
    }
  }
  return null;
}

function collectErrorValues(error: unknown): unknown[] {
  if (Array.isArray(error)) return error.flatMap(collectErrorValues);

  const values: unknown[] = [error];
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (Array.isArray(record.errors)) values.push(...record.errors);
    if (record.lastError) values.push(record.lastError);
    if (record.cause) values.push(record.cause);
    if (record.data) values.push(record.data);
  }
  return values;
}
