# Ziherzika

Mobilna PWA za spremanje YouTube beatova, bilješke i zajedničke glazbene projekte s grupnim chatom.

## Arhitektura

- React + Vite frontend, spreman za GitHub Pages
- Cloudflare Worker API
- Cloudflare D1 za korisnike, projekte, članstva i trake
- Durable Object po projektu za realtime chat i povijest poruka
- YouTube IFrame player za reprodukciju

## Lokalni razvoj

Zahtijeva Node.js 22+.

```bash
npm install
npm run worker:types
npx wrangler d1 migrations apply ziherzika-db --local --config worker/wrangler.jsonc
npm run dev:api
npm run dev
```

Frontend je na `http://localhost:3000`, a API na `http://localhost:8787`.

## Provjere

```bash
npm run build
npx tsc -p worker/tsconfig.json --noEmit
npm run build:api
```

## Deploy

1. Na odabranom Cloudflare računu kreirati D1 bazu i upisati njezin ID u `worker/wrangler.jsonc`.
2. Podesiti `ALLOWED_ORIGINS` na stvarnu GitHub Pages domenu.
3. Primijeniti migracije s `--remote`, pa deployati Worker.
4. GitHub Actions koristi javni Worker URL kao `VITE_API_URL` tijekom builda.
5. U postavkama repozitorija uključiti GitHub Pages iz GitHub Actionsa.

Prijava na Cloudflare i GitHub namjerno nije automatizirana; vlasnik računa je dovršava prije prvog deploya.
