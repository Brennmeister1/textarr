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
  size?: number;
  seeders?: number;
  leechers?: number;
  indexer?: string;
  indexerId?: number;
  age?: number;
  ageHours?: number;
  ageMinutes?: number;
  publishDate?: string;
  downloadUrl?: string;
  magnetUrl?: string | null;
  infoUrl?: string | null;
  protocol?: 'usenet' | 'torrent';
  categories?: Array<{ id: number; name: string }>;
  languages?: Array<{ id: number; name: string }>;
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
  indexerId: number;
  protocol: string;
  languages: string[];
  age: string;
  score: number;
  volumeInfo?: ProwlarrVolumeInfo;
}

export interface ProwlarrVolumeInfo {
  kind: 'single' | 'range' | 'complete' | 'unknown';
  volumes: number[];
  start?: number;
  end?: number;
}

export interface ProwlarrVolumeSummary {
  packs: FilteredProwlarrResult[];
  bestByVolume: FilteredProwlarrResult[];
  foundVolumes: number[];
  unknownResults: FilteredProwlarrResult[];
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
    options?: { params?: Record<string, string | string[]>; body?: unknown }
  ): Promise<T> {
    const url = new URL(this.apiUrl(endpoint));

    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, item);
          }
        } else {
          url.searchParams.set(key, value);
        }
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
        this.logger.error(
          { status: response.status, statusText: response.statusText, error: errorText, url: url.toString() },
          'Prowlarr request failed'
        );
        throw new MediaServiceError(
          'prowlarr',
          `Request failed: ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
          response.status
        );
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

    const params: Record<string, string | string[]> = {
      query,
      type: 'search',
      limit: String(limit),
    };

    if (categories.length > 0) {
      params.categories = categories.map(String);
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
        let results = await this.search(query, categories, limit);

        if (results.length === 0 && categories.length > 0) {
          this.logger.info({ query, categories }, 'No categorized Prowlarr results, retrying without categories');
          results = await this.search(query, [], limit);
        }

        for (const r of results) {
          if (!seen.has(r.guid)) {
            seen.add(r.guid);
            allResults.push(r);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (categories.length > 0) {
          try {
            this.logger.warn(
              { query, categories, error: message },
              'Categorized Prowlarr search failed, retrying without categories'
            );
            const results = await this.search(query, [], limit);
            for (const r of results) {
              if (!seen.has(r.guid)) {
                seen.add(r.guid);
                allResults.push(r);
              }
            }
            continue;
          } catch (fallbackError) {
            const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            this.logger.warn({ query, error: fallbackMessage }, 'Fallback Prowlarr search failed, continuing');
          }
        } else {
          this.logger.warn({ query, error: message }, 'Search term failed, continuing');
        }
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
      query?: string;
      minSeeders?: number;
      maxResults?: number;
    }
  ): FilteredProwlarrResult[] {
    const lang = options?.preferredLanguage?.toLowerCase();
    const query = options?.query?.toLowerCase();
    const minSeeds = options?.minSeeders ?? 0;
    const max = options?.maxResults ?? 5;

    const filtered = results
      .filter((r) => r.guid && r.title)
      .filter((r) => (r.seeders ?? 0) >= minSeeds)
      .map((r) => ({
        guid: r.guid,
        title: r.title,
        size: formatSize(r.size ?? 0),
        seeders: r.seeders ?? 0,
        leechers: r.leechers ?? 0,
        indexer: r.indexer ?? 'Unknown indexer',
        indexerId: r.indexerId ?? 0,
        protocol: r.protocol ?? 'unknown',
        languages: (r.languages ?? []).map((l) => l.name).filter(Boolean),
        age: formatAge(r.ageMinutes ?? 0),
        score: this.scoreResult(r, lang, query),
        volumeInfo: parseVolumeInfo(r.title),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, max);

    return filtered;
  }

  /**
   * Summarize manga/comic results by detected volume coverage.
   */
  summarizeVolumes(
    results: ProwlarrSearchResult[],
    options?: { preferredLanguage?: string; query?: string; maxResults?: number }
  ): ProwlarrVolumeSummary {
    const ranked = this.filterResults(results, {
      preferredLanguage: options?.preferredLanguage,
      query: options?.query,
      minSeeders: 0,
      maxResults: options?.maxResults ?? 100,
    });

    const packs = ranked
      .filter((result) => {
        const info = result.volumeInfo;
        return info?.kind === 'complete' || info?.kind === 'range';
      })
      .slice(0, 5);

    const bestByVolume = new Map<number, FilteredProwlarrResult>();
    const unknownResults: FilteredProwlarrResult[] = [];

    for (const result of ranked) {
      const info = result.volumeInfo;
      if (!info || info.kind === 'unknown') {
        if (unknownResults.length < 5) unknownResults.push(result);
        continue;
      }

      if (info.kind !== 'single') continue;

      const volume = info.volumes[0];
      if (volume === undefined || bestByVolume.has(volume)) continue;
      bestByVolume.set(volume, result);
    }

    const foundVolumes = [...bestByVolume.keys()].sort((a, b) => a - b);

    return {
      packs,
      bestByVolume: foundVolumes.map((volume) => bestByVolume.get(volume)).filter(Boolean) as FilteredProwlarrResult[],
      foundVolumes,
      unknownResults,
    };
  }

  /**
   * Score a result for ranking (higher = better)
   */
  private scoreResult(
    result: ProwlarrSearchResult,
    preferredLanguage?: string,
    query?: string
  ): number {
    let score = 0;
    const title = result.title.toLowerCase();

    // Relevance: keep exact-title matches above loose indexer matches.
    if (query) {
      const normalizedTitle = normalizeForScoring(title);
      const normalizedQuery = normalizeForScoring(query);
      if (normalizedTitle.includes(normalizedQuery)) score += 35;

      const queryTerms = normalizedQuery.split(' ').filter((term) => term.length > 2);
      const matchedTerms = queryTerms.filter((term) => normalizedTitle.includes(term)).length;
      if (queryTerms.length > 0) {
        score += Math.round((matchedTerms / queryTerms.length) * 20);
      }
    }

    // Seeders matter, but should not beat language/relevance entirely.
    score += Math.min(result.seeders ?? 0, 20);

    // Language preference from Prowlarr language metadata and common title tags.
    if (preferredLanguage) {
      const langNames = (result.languages ?? []).map((l) => l.name.toLowerCase());
      const langIds = (result.languages ?? []).map((l) => l.id);
      const hasGerman =
        langNames.includes('german') ||
        langNames.includes('deutsch') ||
        langIds.includes(4) ||
        /\b(ger|german|deutsch|deu)\b/i.test(title);
      const hasEnglish =
        langNames.includes('english') ||
        langIds.includes(1) ||
        /\b(eng|english)\b/i.test(title);

      if (preferredLanguage === 'german') {
        if (hasGerman) score += 60;
        else if (hasEnglish) score += 20;
        else score -= 10;
      } else if (langNames.includes(preferredLanguage)) {
        score += 50;
      }

      // Avoid German+English mixed packs outranking clean German if both are present.
      if (preferredLanguage === 'german' && hasGerman && hasEnglish) {
        score -= 5;
      }
    }

    // Manga/comic release quality hints.
    if (/\b(complete|collection|omnibus|bundle|pack)\b/i.test(title)) score += 12;
    if (/\b(vol\.?|volume|band)\s*\d+/i.test(title)) score += 10;
    if (/\b(ch\.?|chapter|kapitel)\s*\d+/i.test(title)) score += 4;

    // Format preference: epub/cbz/cbr/pdf > other.
    if (title.includes('.epub') || title.includes('epub')) score += 10;
    else if (title.includes('.cbz') || title.includes('cbz')) score += 9;
    else if (title.includes('.cbr') || title.includes('cbr')) score += 9;
    else if (title.includes('.pdf') || title.includes('pdf')) score += 7;
    else if (title.includes('.mobi') || title.includes('mobi')) score += 5;

    // Common low-value/non-release noise.
    if (/\b(sample|preview|trailer|wallpaper|ost|soundtrack)\b/i.test(title)) score -= 25;

    // Protocol: prefer usenet for consistency (0-5)
    if (result.protocol === 'usenet') score += 5;

    // Freshness bonus: newer = better (0-5)
    const ageHours = result.ageHours ?? Number.MAX_SAFE_INTEGER;
    if (ageHours < 24) score += 5;
    else if (ageHours < 168) score += 2;

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

function normalizeForScoring(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseVolumeInfo(title: string): ProwlarrVolumeInfo {
  const normalized = title.toLowerCase();

  const rangeMatch = normalized.match(
    /(?:vol\.?|volume|band|v)\s*(\d{1,3})\s*(?:-|–|—|to|bis)\s*(?:vol\.?|volume|band|v)?\s*(\d{1,3})/i
  );
  if (rangeMatch?.[1] && rangeMatch?.[2]) {
    const start = Number.parseInt(rangeMatch[1], 10);
    const end = Number.parseInt(rangeMatch[2], 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return { kind: 'range', start, end, volumes: range(start, end) };
    }
  }

  if (/\b(complete|collection|omnibus|bundle|pack|komplett|gesamt)\b/i.test(title)) {
    return { kind: 'complete', volumes: [] };
  }

  const singleMatch = normalized.match(/(?:vol\.?|volume|band|v)\s*0*(\d{1,3})\b/i);
  if (singleMatch?.[1]) {
    const volume = Number.parseInt(singleMatch[1], 10);
    if (Number.isFinite(volume)) return { kind: 'single', volumes: [volume], start: volume, end: volume };
  }

  const bracketedNumber = normalized.match(/(?:^|[\s._\-\[\(])0*(\d{1,3})(?:[\s._\-\]\)]|$)/);
  if (bracketedNumber?.[1]) {
    const volume = Number.parseInt(bracketedNumber[1], 10);
    if (Number.isFinite(volume) && volume > 0 && volume < 200) {
      return { kind: 'single', volumes: [volume], start: volume, end: volume };
    }
  }

  return { kind: 'unknown', volumes: [] };
}

function range(start: number, end: number): number[] {
  const values: number[] = [];
  for (let value = start; value <= end; value += 1) {
    values.push(value);
  }
  return values;
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
