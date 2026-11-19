# AffareRadar Homepage 3.0 — proposta di redesign

Nuova homepage statica `index.html` della branch `feature/homepage-redesign-3-0-20261119`, realizzata in modo originale.

## Direzione grafica
**Radar Premium**: blu notte `#071d25`, verde lime `#c7ff69`, bianco caldo `#f6f8f1`; hero con radar animato in CSS, design responsive senza font, librerie o immagini esterne.

## Sezioni
- CTA Telegram `https://t.me/AffareRadarOfferte`, header sticky e CTA mobile.
- Categorie illustrate descrittive (nessun collegamento fittizio).
- Vetrina che carica `entra/offerte.json` quando disponibile, senza mostrare dati non approvati.
- Spiegazione delle verifiche, FAQ, disclosure affiliate.

## Test effettuati
Chromium locale con HTML in memoria (`set_content`), non deploy:
- viewport 320, 390, 768, 1100, 1440px: senza overflow orizzontale, una sola H1, nessun errore JavaScript osservato.
- menu mobile e FAQ: funzionano.
- feed mock: una offerta valida mostrata su quattro, scartando scaduta, non approvata e dominio non permesso.

## Limitazioni
- La PR #34 (landing `entra/`) è distinta: il feed reale non è ancora disponibile sulla main. In questo caso la homepage mostra il fallback verso Telegram.
- L'approvazione in un JSON da sola non comprova la validità commerciale: devono esistere controlli affidabili a monte.
- Restano da verificare hosting live, policy affiliate aggiornate, privacy e accessibilità completa con utenti e screen reader.
- Niente merge, deploy, ads, tracciamento o invio Telegram automatico.

Stato: **bozza / review richiesta**, main immutata.