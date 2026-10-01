# AffareRadar Telegram Publisher

Backend serverless per Vercel.

## Variabili ambiente richieste

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `PUBLISH_SECRET`

Non salvare mai questi valori nel repository.

## Endpoint

### GET /api/health
Verifica configurazione.

### POST /api/telegram

Header:

```
x-affareradar-secret: <PUBLISH_SECRET>
Content-Type: application/json
```

Payload esempio:

```json
{
  "title": "Anker MagGo Power Bank 10.000 mAh Qi2",
  "price": "52,99 €",
  "oldPrice": "89,99 €",
  "discount": "-41%",
  "category": "Telefonia & Accessori",
  "reason": "Forte ribasso rispetto al prezzo di riferimento",
  "asin": "B0CFDQ9QH5",
  "amazonUrl": "https://www.amazon.it/dp/B0CFDQ9QH5?tag=affareradar-21",
  "imageUrl": "https://cdn.shopify.com/s/files/1/0710/2169/1017/files/20240109-154532.png?v=1753071223"
}
```

Il bot pubblica una card con foto, testo e pulsante Amazon affiliato.
