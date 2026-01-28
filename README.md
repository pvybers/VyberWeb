Vyber Web — interactive video “worlds” (Next.js App Router + TypeScript).

## Getting started

- **1) Configure env**
  - Copy `env.example` to `.env` (your environment already loads `.env` during `next dev`)
  - Set `DATABASE_URL` to your Neon Postgres connection string.

- **2) Install + run**

```bash
npm install
npm run dev
```

Open `http://localhost:3000` — it will seed a `default` world from `worldPrompt.txt` and redirect to `/worlds/default`.

## Notes

- **DB tables** are created automatically on first request (`lib/db.ts` → `ensureSchema()`).
- **Video playback** uses Plyr with **no visible controls**, plus a **two-player swap at ~4.8s** to avoid black frames.
- **API**: `POST /api/worlds/[worldId]/step` is implemented and currently returns placeholder clips/actions until NanoBanana + Seedance adapters are wired.

