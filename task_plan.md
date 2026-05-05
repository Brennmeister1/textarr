# Task Plan: Prowlarr-Suche für Bücher & Comics

## Ziel
User kann per Telegram nach Büchern/Comics suchen. Der Bot sucht Prowlarr über die API, filtert die besten Treffer (Sprache, Seeds, Format), präsentiert Top 5 zur Auswahl und leitet den Download via Prowlarr an qBittorrent/SABnzbd weiter.

## Workflow
```
"Ich will das Buch Die Bibel"
  -> AI parst: action=search_book, title="Die Bibel"
  -> AI generiert Suchvarianten: "Die Bibel", "Bibel", "Das neue Testament"
  -> Prowlarr.search() mit Kategorie-Filter (Bücher/Comics)
  -> Filter: deutsch, seeds>0, epub>pdf>mobi
  -> Top 5 Ergebnisse präsentieren
  -> User wählt Nr. 2
  -> Prowlarr.grabRelease() -> Download-Client
```

## Phasen

### 1. 🔄 ProwlarrService erstellen
- `src/services/prowlarr.service.ts` (neu, ~180 Zeilen)
- API: `/api/v1/search`, `/api/v1/release`
- Auth: X-Api-Key (wie Sonarr/Radarr)
- Methoden: search(), grabRelease(), testConnection()
- Kategorien: Bücher=8000,8010 Comics=7020,7030

### 2. 🔄 Config erweitern
- `src/config/index.ts`: +prowlarr { url, apiKey }
- `src/config/storage.ts`: Schema + SECRET_FIELDS + isConfigComplete()
- `src/index.ts`: buildRuntimeConfig() mapping

### 3. 🔄 Service-Registrierung
- `src/services/index.ts`: Services-Interface + createServices()
- `src/services/container.ts`: prowlarr-Getter + ConnectionTest

### 4. 🔄 AI-Parser erweitern
- `src/services/ai.service.ts`: actions search_book, search_comic
- `src/schemas/media.schema.ts`: ActionType + MediaType
- System-Prompt: Buch/Comic erkennen lernen

### 5. 🔄 MessageHandler erweitern
- case search_book / search_comic
- handleProwlarrSearch(): Varianten, API, Filter, Top 5
- handleProwlarrSelection(): User-Wahl -> grabRelease()

### 6. 🔄 Constants + Routing
- `src/constants/index.ts`: Emojis + Labels
- `src/routes/config.route.ts`: Connection-Test-Typ

### 7. 🔄 Testen
- Docker-Build lokal
- Prowlarr-Connection testen
- Buch-Suche + Download testen

### 8. 🔄 Deploy
- Commit + Push -> Actions Build -> Server Pull

## Fehlerprotokoll
| Fehler | Versuch | Lösung |
|--------|---------|--------|
| - | - | - |