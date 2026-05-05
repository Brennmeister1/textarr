# Progress: Prowlarr-Suche für Bücher & Comics

## Phase 1: ProwlarrService erstellen ✅
- [x] `src/services/prowlarr.service.ts` erstellt (~230 Zeilen)
- [x] search() + multiSearch() mit Kategorie-Filter
- [x] grabRelease() für Download
- [x] filterResults() mit Ranking (Sprache, Seeds, Format)
- [x] buildSearchTerms() für Suchvarianten
- [x] testConnection() + getIndexers()

## Phase 2: Config erweitern ✅
- [x] `src/config/index.ts`: prowlarr-Config { url, apiKey }
- [x] `src/config/storage.ts`: Schema + SECRET_FIELDS
- [x] `src/index.ts`: buildRuntimeConfig() mapping
- [x] `src/utils/errors.ts`: 'prowlarr' zu MediaServiceError

## Phase 3: Service-Registrierung ✅
- [x] `src/services/index.ts`: Services-Interface + createServices() + Exports
- [x] `src/services/container.ts`: prowlarr-Getter + ConnectionTest + TestConnections
- [x] `src/routes/config.route.ts`: TestConnectionBody + apiVersion-Fix

## Phase 4: AI-Parser erweitern 🔄
- [ ] `src/services/ai.service.ts`: Actions + Prompt
- [ ] `src/schemas/media.schema.ts`: ActionType + MediaType

## Phase 5: MessageHandler erweitern 🔄
- [ ] case search_book / search_comic
- [ ] handleProwlarrSearch()
- [ ] handleProwlarrSelection()

## Phase 6: Constants + Routing 🔄
- [ ] `src/constants/index.ts`
- [ ] `src/routes/config.route.ts`

## Phase 7: Testen 🔄
## Phase 8: Deploy 🔄

## Session-Log
| Zeit | Aktion | Ergebnis |
|------|--------|----------|
| 17:00 | Planung + Analyse | Plan erstellt |
| 17:15 | Branch feature/prowlarr-book-search | Erstellt + gepusht |
| 17:20 | Phase 1: ProwlarrService | 230 Zeilen, multiSearch, Ranking |
| 17:25 | Phase 2: Config | storage.ts + index.ts + errors.ts |
| 17:30 | Phase 3: Service-Registrierung | container + routes + build ok |