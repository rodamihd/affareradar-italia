# AffareRadar PR #36 — gate di rilascio e prova editoriale

**Modalita:** DRAFT / SHADOW / NO MERGE. Nessuna pubblicazione automatica o attivazione commerciale consentita da questo documento.

## Evidenze verificate (2026-11-22)
- Repo `rodamihd/affareradar-italia`; base `5a39216a0b108349f159e715dcbbb8f9330b45cb`.
- CI: workflow `AffareRadar Pre-Publish and Storefront Safety`, run `45061653078`, su commit `4226f031ea1da5bba9d2ff0de0b75de09025a6e4`; 33/33 test sintetici PASS, test legacy PASS.
- Vercel: deployment preview `dpl_GctQARzZf5GmHfqPwHNS9DWe4f6N` READY e status GitHub Vercel SUCCESS.
- Un risultato READY non attesta correttezza di prezzi, disponibilita, licenze, affiliate policy o accesso reale alle offerte.

## Prova editoriale obbligatoria — mai presunta dai flag JSON
Per ciascuna offerta candidata, il revisore deve registrare in un registro autorizzato e accessibile solo al team:
1. Identita prodotto (ASIN + variante + seller), link diretto canonico.
2. Fonte autorizzata e condizioni d'uso applicabili; prova documentale della licenza e dei diritti di visualizzazione/conservazione.
3. Origine del prezzo effettivo, importo finale (spedizione, IVA, coupon), verificato con strumento autorizzato e timestamp UTC.
4. Disponibilita verificata e condizioni di eleggibilita (Prime, iscrizione, limite cliente, scadenza).
5. Evidenza dei prezzi di confronto e sconti, se dichiarati; nessuna stima estratta dal testo come prova di prezzo precedente.
6. Identificativo e approvazione del revisore, digest del record, esito APPROVE/REJECT/HOLD, motivo e conservazione minima necessaria.
7. Revisione distinta per provenienza tecnica e pubblicazione editoriale; impedire auto-approvazione e attestazioni puramente fornite dal chiamante.

**Attenzione:** `status=approved`, `source_authorized=true`, `rights_verified=true`, `price_verified_by_amazon=true` e `review_reference` sono *asserzioni nel payload*, non prove indipendenti. Il flusso corrente accetta tali valori con doppia credenziale: NON e' ancora idoneo alla pubblicazione commerciale automatica. Occorre un registro server-side di evidenze non scrivibile dal chiamante che inserisce l'offerta, con autorizzazioni distinte, e un adapter API autorizzato che attesti il prezzo.

## Preflight Top 5
- I crons attuali schedulano `discover-multisource` alle 20:00 UTC e `daily-top5` alle 21:00 UTC. Sono orari UTC; non corrispondono alle 20/21 locali in Italia.
- Per prodotti, Top5 deve trovare `verification.state=VERIFIED`, `verification.verifiedAt` entro 10 minuti, `stock=true`, lifecycle valido, URL HTTPS Amazon coerente e promozione non scaduta.
- Se un requisito manca, esito `no_fresh_verified_deals_for_top5` e **nessun invio**. Non allungare arbitrariamente la soglia o inventare verifiche.
- Inserire soltanto dopo approvazione e prove di licenza un job di ri-verifica reale prima della pubblicazione (preflight con API autorizzata); altrimenti disabilitare/tenere vuoto il Top 5.
- Attenzione: una stringa `price_source` o `verification.state` fornita dal chiamante non e' prova d'origine dell'API.

## Gate tecnici
- [x] Node syntax e test di regressione nel workflow CI (33/33 PASS al run sopra).
- [x] Vercel preview READY sul commit sopra.
- [ ] Collaudo end-to-end della pagina in browser e degli stati responsive.
- [ ] Test HTTP dell'ingest con credenziali **sintetiche in ambiente isolato**; non usare Redis condiviso tra preview e produzione.
- [ ] Test E2E autenticazione, race, idempotenza, scadenza, deduplica e rate limit.
- [ ] Test di revoca / rotazione credenziali e doppia approvazione indipendente.
- [ ] Convalida autentica dei dati ufficiali con prova di diritti e contratto vigente.
- [ ] Verifica hosting/piano commerciale e limiti cron/funzioni/costi.
- [ ] Approvazione umana del release owner e rollback verificabile.

## Decisione
**HOLD / REVIEW_REQUIRED.** Branch e PR #36 rimangono isolati. Nessun merge/deploy production/Telegram posting senza nuovo consenso, test di integrazione attendibili ed evidenze dei controlli mancanti.

## Hardening tecnico aggiuntivo (2026-11-22)
- Introdotto `lib/storefront-evidence-gate.js`: lega record pubblicabile a un documento di revisione *separato* in Redis mediante digest SHA-256 di identita, prezzo, fonte, timestamp, scadenza e reference; richiede due revisori distinti e metadati di diritti/prezzo/stock/spedizione.
- `lib/public-offers-handler.js` rilegge il documento a ogni inserimento e lettura: mancanza, scadenza, digest diverso o revoca bloccano il record. Nessun endpoint per generare automaticamente il documento trusted; il flusso rimane in HOLD fino a un writer autenticato separato e alla prova reale dei diritti.
- Su Vercel preview: POST disabilitato; GET offre una risposta vuota indipendentemente dal Redis condiviso. Su production il POST e' disabilitato per default se non e' esplicitamente impostato `AFFARERADAR_STOREFRONT_INGEST_ENABLED=true`. Non configurare il flag senza una revisione separata.
- Una coppia di id revisore e una reference licenza nel documento trusted non provano da soli che esistano due esseri umani, un contratto o un dato Amazon autenticato. SHA-256 rileva differenze fra i campi ma NON autentica la fonte, per cui il gate di rilascio resta **HOLD**.
- Test di rifiuto aggiunti: record trusted assente, digest falsificato, due id revisore uguali, revoca, preview isolata e ingest disabilitato. L'esito CI della nuova revisione va verificato separatamente.
