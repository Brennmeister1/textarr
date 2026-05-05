import type { Logger } from '../utils/logger.js';
import { MediaServiceError } from '../utils/errors.js';

/**
 * Prowlarr configuration
 */
export interface ProwlarrConfig {
  url: string;
  apiKey: string;
}

/**
 * Prowlarr search categories
 */
export const PROWLARR_CATEGORIES = {
  books: [8000, 8010],
  comics: [7020, 7030],
  magazines: [7010],
} as const;

export type ProwlarrMediaType = keyof typeof PROWLARR_CATEGORIES;

/**
 * Raw search result from Prowlarr API
 */
export interface ProwlarrSearchResult {
  guid: string;
  title: string;
  size: number;
  seeders: number;
  leechers: number;
  indexer: string;
  indexerId: number;
  age: number;
  ageHours: number;
  ageMinutes: number;
  publishDate: string;
  downloadUrl: string;
  magnetUrl: string | null;
  infoUrl: string | null;
  protocol: 'usenet' | 'torrent';
  categories: Array<{ id: number; name: string }>;
  languages: Array<{ id: number; name: string }>;
}

/**
 * Filtered + ranked search result for user presentation
 */
export interface FilteredProwlarrResult {
  guid: string;
  title: string;
  size: string;
  seeders: number;
  leechers: number;
  indexer: string;
  protocol: string;
  languages: string[];
  age: string;
  score: number;
}

/**
 * Prowlarr API client for searching and grabbing releases
 */
export class ProwlarrService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly logger: Logger;

  constructor(config: ProwlarrConfig, logger: Logger) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.logger = logger.child({ service: 'prowlarr' });
  }

  private get headers(): Record<string, string> {
    return {
      'X-Api-Key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  private apiUrl(endpoint: string): string {
    return `${this.baseUrl}/api/v1/${endpoint.replace(/^\//, '')}`;
  }

  /**
   * Make an API request to Prowlarr
   */
  private async request<T>(
    method: string,
    endpoint: string,
    options?: { params?: Record<string, string>; body?: unknown }
  ): Promise<T> {
    const url = new URL(this.apiUrl(endpoint));

    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        url.searchParams.set(key, value);
      }
    }

    this.logger.debug({ method, url: url.toString() }, 'Prowlarr request');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: this.headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        this.logger.error({ status: response.status, error: errorText }, 'Prowlarr request failed');
        throw new MediaServiceError('prowlarr', `Request failed: ${response.statusText}`, response.status);
      }

      const text = await response.text();
      return text ? (JSON.parse(text) as T) : (null as T);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error({ url: url.toString() }, 'Prowlarr request timed out');
        throw new MediaServiceError('prowlarr', 'Request timed out', 408);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Search Prowlarr for releases
   */
  async search(
    query: string,
    categories: readonly number[] = [],
    limit = 50
  ): Promise<ProwlarrSearchResult[]> {
    this.logger.info({ query, categories }, 'Searching Prowlarr');

    const params: Record<string, string> = {
      query,
      type: 'search',
      limit: String(limit),
    };

    if (categories.length > 0) {
      params.categories = categories.join(',');
    }

    return this.request<ProwlarrSearchResult[]>('GET', 'search', { params });
  }

  /**
   * Search with multiple query terms and deduplicate results
   */
  async multiSearch(
    queries: string[],
    categories: readonly number[] = [],
    limit = 50
  ): Promise<ProwlarrSearchResult[]> {
    const seen = new Set<string>();
    const allResults: ProwlarrSearchResult[] = [];

    for (const query of queries) {
      try {
        const results = await this.search(query, categories, limit);
        for (const r of results) {
          if (!seen.has(r.guid)) {
            seen.add(r.guid);
            allResults.push(r);
          }
        }
      } catch (error) {
        this.logger.warn({ query, error }, 'Search term failed, continuing');
      }
    }

    this.logger.info({ queries: queries.length, results: allResults.length }, 'Multi-search complete');
    return allResults;
  }

  /**
   * Grab a release (send to download client)
   */
  async grabRelease(guid: string, indexerId: number): Promise<void> {
    this.logger.info({ guid, indexerId }, 'Grabbing release');

    await this.request('POST', 'release', {
      body: { guid, indexerId },
    });
  }

  /**
   * Filter and rank search results
   */
  filterResults(
    results: ProwlarrSearchResult[],
    options?: {
      preferredLanguage?: string;
      minSeeders?: number;
      maxResults?: number;
    }
  ): FilteredProwlarrResult[] {
    const lang = options?.preferredLanguage?.toLowerCase();
    const minSeeds = options?.minSeeders ?? 0;
    const max = options?.maxResults ?? 5;

    const filtered = results
      .filter((r) => r.seeders >= minSeeds)
      .map((r) => ({
        guid: r.guid,
        title: r.title,
        size: formatSize(r.size),
        seeders: r.seeders,
        leechers: r.leechers,
        indexer: r.indexer,
        protocol: r.protocol,
        languages: r.languages.map((l) => l.name),
        age: formatAge(r.ageMinutes),
        score: this.scoreResult(r, lang),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, max);

    return filtered;
  }

  /**
   * Score a result for ranking (higher = better)
   */
  private scoreResult(result: ProwlarrSearchResult, preferredLanguage?: string): number {
    let score = 0;

    // Seeders are king (0-30 points)
    score += Math.min(result.seeders, 30);

    // Language preference (0-20 points)
    if (preferredLanguage) {
      const langNames = result.languages.map((l) => l.name.toLowerCase());
      const langIds = result.languages.map((l) => l.id);

      // German = 4
      if (langNames.includes(preferredLanguage) || (preferredLanguage === 'german' && langIds.includes(4))) {
        score += 20;
      }
      // English = 1 (fallback)
      else if (langNames.includes('english') || langIds.includes(1)) {
        score += 10;
      }
    }

    // Format preference: epub > pdf > mobi > other (0-10)
    const title = result.title.toLowerCase();
    if (title.includes('.epub') || title.includes('epub')) score += 10;
    else if (title.includes('.pdf') || title.includes('pdf')) score += 7;
    else if (title.includes('.mobi') || title.includes('mobi')) score += 5;

    // Protocol: prefer usenet for consistency (0-5)
    if (result.protocol === 'usenet') score += 5;

    // Freshness bonus: newer = better (0-5)
    if (result.ageHours < 24) score += 5;
    else if (result.ageHours < 168) score += 2;

    return score;
  }

  /**
   * Build search term variants from a title
   */
  buildSearchTerms(title: string): string[] {
    const terms: string[] = [title];
    const lower = title.toLowerCase();

    // Add without leading article (German/English)
    for (const article of ['der ', 'die ', 'das ', 'the ', 'a ', 'an ']) {
      if (lower.startsWith(article)) {
        terms.push(title.slice(article.length).trim());
        break;
      }
    }

    return [...new Set(terms)];
  }

  /**
   * Test connection to Prowlarr
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.request<unknown>('GET', 'system/status');
      this.logger.info('Prowlarr connection successful');
      return true;
    } catch (error) {
      this.logger.error({ error }, 'Prowlarr connection failed');
      return false;
    }
  }

  /**
   * Get configured indexers
   */
  async getIndexers(): Promise<Array<{ id: number; name: string; enable: boolean }>> {
    return this.request('GET', 'indexer');
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatAge(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}