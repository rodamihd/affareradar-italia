# Landing AffareRadar /entra — proposta 2.1

Pagina di acquisizione Instagram/Facebook verso il canale Telegram @AffareRadarOfferte. La homepage `index.html` resta invariata.

## Stato e sicurezza
- Feed statico locale `entra/offerte.json` inizialmente vuoto; nessuna offerta inventata.
- Mostra solo elementi `approved`, `source_authorized=true` e `rights_verified=true`, con timestamp non scaduto e verificato da meno di 120 minuti.
- Destinazioni consentite: HTTPS `amazon.it` o `www.amazon.it`. Il titolo è reso come testo, non HTML. Un feed JSON controllato solo dal browser non è prova sufficiente per autorizzare la pubblicazione: il produttore deve validare server-side.
- Nessun pixel, form, tracking persistente o richiesta a servizi di terzi; le CTA Telegram sono link esterni espliciti.
- Il feed non è collegato al bot reale e non vengono misurate visite, clic, iscrizioni né vendite.

## Contratto feed JSON (schema_version 1)
`offers` è un array con record contenenti:
`title` (stringa 3–130), `merchant` (stringa fino a 70), `url` (HTTPS Amazon.it), `price_eur` (numero >0), `verified_at` e `expires_at` (ISO 8601), `status: "approved"`, `source_authorized: true`, `rights_verified: true`.
Il file iniziale usa `{"schema_version":1,"generated_at":null,"offers":[]}`.

## Da completare prima di merge e deploy
1. Controllare hosting idoneo e funzionamento di `/entra/`.
2. Identificare titolare e informativa privacy per eventuali log tecnici dell'hosting.
3. Verificare la policy Amazon Associates, contenuti e link affiliati ammessi e l'origine dei dati.
4. Collegare un export autorizzato dal motore di offerte soltanto con validazioni e approvazioni verificabili.
5. Testare browser reali e accessibilità; confermare il profilo Instagram di proprietà.
6. Aggiungere analytics solo dopo revisione privacy specifica.

Stato: **bozza tecnica in PR, non pubblicata**. Nessuna spesa, tracking o automazione di pubblicazione.
