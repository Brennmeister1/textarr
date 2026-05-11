# Prowlarr Manga Volume Search Plan

## Goal

Improve Textarr's Prowlarr manga/comic search so users can ask for all available volumes, not just a single best release.

Example requests:

- `Finde alle Baende Goblin Slayer Year One`
- `Suche alle Volumes von Berserk`
- `Find all German volumes of One Piece manga`

## Current Behavior

- Textarr detects manga/comic intent via AI and routes to `search_comic`.
- Prowlarr is searched for the parsed title.
- Results are ranked and the top 5 are shown.
- User chooses one release to grab.

This works for single releases but not for collecting all available volumes.

## Why Gemini Alone Is Not Enough

Gemini can infer likely manga metadata, but it should not be treated as authoritative for complete volume lists because:

- Manga volume counts change over time.
- German/localized releases can lag behind the original release.
- Omnibus/collector editions use different numbering.
- Spin-offs such as `Goblin Slayer Year One` can be confused with the main series.
- Training data may be stale or incomplete.

Gemini is useful for intent parsing and title cleanup, but not for verifying completeness.

## Proposed Approach

Use Prowlarr results as the source of truth and group them by detected volume information.

### 1. Detect All-Volumes Intent

Extend AI parsing or post-processing to detect phrases like:

- `alle Baende`
- `alle Bände`
- `all volumes`
- `complete series`
- `komplett`
- `Band 1 bis ...`

Add a flag such as:

```ts
wantAllVolumes: boolean
```

### 2. Extract Volume Numbers From Release Titles

Detect volume patterns in Prowlarr release titles:

```text
Vol. 01
Volume 1
Band 01
v01
001
01-05
Vol 1-3
Complete
Collection
Omnibus
Bundle
Pack
```

Normalize matches into structured data:

```ts
interface VolumeInfo {
  kind: 'single' | 'range' | 'complete' | 'unknown';
  volumes: number[];
  start?: number;
  end?: number;
}
```

### 3. Group Results By Volume

After Prowlarr search:

- Group single-volume results by volume number.
- Expand ranges into multiple covered volumes.
- Keep packs/complete releases in a separate high-priority group.
- Prefer German releases when configured.
- Prefer CBZ/CBR/EPUB/PDF formats.
- Prefer seeders and reliable indexers after language/relevance.

### 4. Present A Volume Coverage Summary

Instead of only top 5 releases, respond with coverage:

```text
Found German/English results for "Goblin Slayer Year One":

Best packs:
1. Goblin Slayer Year One Vol. 01-05 German CBZ

Individual volumes found:
- Vol. 01: 3 candidates, best: German CBZ
- Vol. 02: 2 candidates, best: German CBZ
- Vol. 03: 1 candidate, best: English CBZ
- Vol. 04: not found
- Vol. 05: 1 candidate, best: German PDF

I cannot verify the complete official volume count from Prowlarr alone.
Reply with:
1. Grab best pack
2. Grab best individual releases
3. Show details
```

### 5. Grab Multiple Releases

Add a selection flow for bulk grabbing:

- `Grab best pack`
- `Grab all best individual volumes`
- `Grab only German matches`
- `Show details`

When grabbing individual volumes, use each result's real `indexerId`.

### 6. Optional External Source Later

If stronger completeness validation is needed, add an optional metadata lookup layer:

- AniList API
- MangaDex API
- Kitsu API

This should be optional and used only to estimate expected volume counts. Prowlarr remains the actual availability source.

## Implementation Notes

- Keep the first version Prowlarr-only.
- Do not let Gemini invent complete volume counts.
- Phrase responses honestly: "found volumes" instead of "complete series" unless a complete/pack release exists.
- Make German preference configurable instead of coupling it to TMDB language long-term.
