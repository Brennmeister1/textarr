# Findings: Prowlarr-Suche für Bücher & Comics

## Architektur-Entscheidungen

### 1. Direkter Prowlarr-API-Zugriff (nicht über Mylar/Readarr)
- Prowlarr läuft bereits im Stack: `172.19.0.2:9696`
- API ist identisch zu Sonarr/Radarr (Servarr-Standard)
- Auth via X-Api-Key Header
- Kein Library-Management nötig -> simpler als Sonarr/Radarr

### 2. Prowlarr API Endpunkte
- `GET /api/v1/search?query=X&categories=8000,8010&type=search`
- `POST /api/v1/release` mit `{ guid, indexerId }` zum Grabben
- Kategorien: 7000er=Comics, 8000er=Bücher
- Response: title, size, seeders, leechers, indexer, age, languages, downloadUrl

### 3. Workflow-Unterschied zu Movies/TV
| Aspekt | Movies/TV | Bücher/Comics |
|--------|-----------|---------------|
| Metadaten-Quelle | TMDB | Keine (nur Prowlarr) |
| Suchstrategie | TMDB -> Library-Check -> Add | Prowlarr direkt |
| Ergebnis-Typ | Titel zum Monitoren | Release zum Download |
| Download | *arr managed | Prowlarr -> qBittorrent/SAB |

### 4. Suchvarianten-Strategie
AI generiert aus dem Titel mehrere Suchbegriffe:
- Original-Titel: "Die Bibel"
- Ohne Artikel: "Bibel"
- Untertitel: "Das neue Testament", "Das alte Testament"
- Pro Begriff Prowlarr.search() -> Ergebnisse deduplizieren

### 5. Filter-Kriterien
- Sprache: Deutsch bevorzugt (config.language oder aus Titel erkennen)
- Seeds: >0 Mindestanforderung
- Format-Ranking: epub (3) > pdf (2) > mobi (1) > sonst (0)
- Größe: Plausibilitäts-Check (Buch >500KB)

### 6. Code-Struktur (nach bestehendem Muster)
- Neue Dateien folgen exakt dem SonarrService-Pattern
- BaseMediaService.request() kann wiederverwendet werden
- MessageHandler-Flow nutzt bestehendes Session/Selection-System

## Risiken
| Risiko | Mitigation |
|--------|------------|
| AI erkennt Buch/Comic nicht | Prompt mit Beispielen füttern |
| Prowlarr findet nichts | Suchvarianten + breitere Kategorien |
| Zu viele Ergebnisse | Strenge Filter, max 5 zeigen |
| Download schlägt fehl | Error-Handling in grabRelease() |