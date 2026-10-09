# Accessible Rides (prototype)

Simplified, accessible booking flow: name + phone -> promos -> addresses -> tokenized payment -> ride request.

## Run
    npm install
    npm start          # mock mode, http://localhost:3000
    npm test

## Going live
1. `cp endpoints.example.json endpoints.json` and fill in the URLs, methods, headers and body fields from the
   Uber documentation/agreement you were given. Placeholders: `{{name}} {{phone}} {{promoCode}} {{pickup}}
   {{dropoff}} {{paymentToken}} {{accountToken}} {{apiKey}}`. Adjust field names in `uberClient.js`/`server.js`
   (`access_token`, `request_id`, ...) to match the real response shapes.
2. Set env: `UBER_MODE=live`, `UBER_API_KEY`, `PROMO_CODES=CODE1,CODE2`, `STRIPE_PUBLISHABLE_KEY` (or your gateway; swap the
   tokenization block in `public/app.js`).
3. Serve behind HTTPS only. Keep `endpoints.json` and keys out of git.

## Privacy
Personal data lives in server memory for at most 30 minutes, is cleared after booking, and is never logged.
Raw card data goes browser -> payment gateway only; the server sees just the token.
