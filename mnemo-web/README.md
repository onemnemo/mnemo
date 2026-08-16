# mnemo-web

React frontend for the Mnemo desktop app, served by Mnemo.Host (PhotinoX).

## Dev workflow

1. Start Mnemo.Host in dev mode first. It writes `.dev/api.json` (`{ port, token }`) into this
   directory on startup, and listens on `http://127.0.0.1:47210`.
2. Then run:

   ```
   npm run dev
   ```

Vite's dev server proxies `/api/*` to Mnemo.Host (see `vite.config.ts`). On every proxied
request it reads `.dev/api.json` and injects `Authorization: Bearer <token>` for you, so the
app itself doesn't need a token in dev. If the file is missing or unreadable, requests are
proxied without the header instead of crashing the dev server.

## Production build

```
npm run build
```

The build output (`dist/`) is consumed directly by Mnemo.Host's static file server - there is
no separate deployment step.

## Same-origin design

The app never talks cross-origin. In both dev (via the Vite proxy) and prod (served by
Mnemo.Host itself), API calls go to the same origin the page was loaded from, so there is no
CORS configuration anywhere in this stack.

## Auth token mechanism

- **Prod:** Mnemo.Host templates a token into `index.html` at runtime as `window.__MNEMO_TOKEN__`.
  `src/api/client.ts` reads it and attaches `Authorization: Bearer <token>` when present.
- **Dev:** `window.__MNEMO_TOKEN__` is absent. Instead, the Vite proxy reads the token from
  `.dev/api.json` and injects the header at the proxy layer (see `vite.config.ts`).

Either way, `apiFetch` in `src/api/client.ts` is the single place requests are made - callers
don't need to know which mechanism is in play.
