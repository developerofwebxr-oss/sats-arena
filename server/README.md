# Sats Arena — Lightning backend

A small Express service that fronts a hosted LNbits wallet and exposes a
session-centric API to the game. It holds the LNbits **Invoice/read key** in an
environment variable — never in this repo.

This folder is **isolated** from the game: it has its own `package.json`, so the
GitHub Pages build (Vite, at the repo root) never installs or bundles it.

## Endpoints
- `GET  /health` → `{ ok: true }`
- `POST /session` → `{ code }` — create a 4-char session
- `GET  /session/:code` → `{ exists, paidCount }` — poll status (checks LNbits for settled invoices)
- `POST /session/:code/invoice` → `{ payment_hash, payment_request }` — new 21-sat invoice for the code

## Env vars
See `.env.example`. Required: `LNBITS_URL`, `LNBITS_INVOICE_KEY`.
Optional: `INVOICE_AMOUNT` (default 21), `ALLOWED_ORIGIN`, `PORT`.

## Run locally
```
cd server
cp .env.example .env      # then paste your real LNbits values into .env
npm install
node --env-file=.env server.js
```

## Deploy
Deployed on Railway with **root directory = `server`**. Env vars are set in the
Railway dashboard (Variables), not committed. See the deploy steps in chat.
