# Accessible ride booking (prototype)

Simple, screen-reader-friendly web flow that books a ride on a rider's behalf:
details → (account + offers) → pickup/drop-off → payment → live ride status.

Zero dependencies (Node ≥ 20).

```bash
npm run dev     # mock Uber + gateway on :4000, app on http://localhost:3000
npm test
```

## Connecting the real Uber endpoints

All Uber specifics come from `.env` (see `.env.example`): base URL, partner key, and
four path templates. Field names in requests/responses are mapped in **one file**,
`src/uberClient.js` — edit those mappers to match the contract in your Uber
documentation. Keep the agreement/credential reference with your own records
(e.g. in your deployment docs), not in code.

## Payment

The browser sends card data directly to the gateway at `PAYMENT_TOKENIZE_URL` and
passes only the returned token to our server. The server rejects anything that looks
like a card number. For production PCI scope, use your gateway's hosted fields/iframe
(e.g. Stripe Elements) instead of the plain inputs in `public/app.js`; the server side
needs no change.

## Guardrails built in

- Explicit consent required before an account is created.
- One account per phone number per 24h and per-IP hourly cap (`MAX_REGISTRATIONS_PER_HOUR`).
- At most 3 promo codes per account, taken from `PROMO_CODES` (your entitlements); an invalid code is reported but never blocks the booking.
- Name/phone are forwarded to Uber and not retained; sessions live in memory, expire after 30 min, and are destroyed on booking. Logs never contain request bodies.
- Security headers + CSP; HTTPS to Uber enforced (http only for localhost mocks).

## Accessibility

Skip link, labelled fields with `autocomplete` tokens, focus moves to each step heading,
error summary with `role=alert` and focus on the offending field, `aria-live` ride status,
large touch targets (≥ 3.25rem), 4px focus ring, dark mode, reduced-motion respected.
Still worth a manual pass with VoiceOver/NVDA and users with disabilities before launch.
