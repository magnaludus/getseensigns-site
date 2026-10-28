# Designer dev tooling

Tests, screenshots, Lighthouse and the vendored-library build for the online designer. Nothing here is
deployed. The Pages deploy copies the repo with `rsync --exclude='.*'`, so dot-directories never reach
the live site (see `.github/workflows/deploy-cloudflare-pages.yml`, which this work does not touch).
The site itself has no build step for these files: `assets/design/` is plain ES modules.

Needs Node 22 or newer and Python 3.

```
cd .design-dev
npm ci                      # dev dependencies only: playwright, axe-core, lighthouse, esbuild, three
npx playwright install chromium   # skip if Chromium is already installed
```

| Command | What it does |
|---|---|
| `npm run test:unit` | `node --test` on the pure modules: document model, history, layout, geometry, templates, pricing, share links, zip, review rules, 3D geometry and models, both designer Pages Functions, the designer proof endpoint on D1 + Brevo (`design-proof-d1.test.mjs`), and the order flow (`orders.test.mjs`: proof approval evidence, Stripe Checkout params, webhook, disputes, tracking, emails). About 2 seconds. |
| `npm run test:e2e` | Playwright against the built site: prices for every option, touch flow on a 390×844 phone, keyboard-only flow, axe accessibility scan, four different tent sides in 3D, no Three.js request before the 3D view opens, WebGL off, and the proof request with the server on, off (503) and stored-but-not-emailed. About a minute. |
| `npm run test:3d` | The 3D stage on its own in headless Chromium with software WebGL: every product, scene and viewport, orientation of each side, colors, orbit and touch, disposal, context loss and failure modes. Takes about 5 minutes and writes screenshots to `.design-dev/out/three/`. `THREE_ONLY=resize,motion` runs only some sections. |
| `npm run shots` | Screenshots of every product, Flat and 3D, at 1440×900 and 390×844, into `.design-dev/out/shots/`. |
| `npm run lighthouse -- /design/ /design/canopy-tent/` | Lighthouse mobile (simulated Slow 4G, 4× CPU) against the built site served with gzip and HTTP/2. `LH_PROTOCOL=h1` serves HTTP/1.1 instead, which is the pessimistic case. |
| `python3 scripts/shots-to-webp.py <in> <out>` | Shrinks screenshots to WebP for a pull request (needs `pip install pillow`). |
| `npm run vendor` | Rebuilds `assets/design/vendor/three.module.min.js` from the pinned `three` version with esbuild. Only needed to change the Three.js version. |

The tests read the built pages, so run `python3 src/site-src-pages.py` first when you change `src/`.

`harness/` holds small pages for looking at one piece on its own (stage, templates, the 3D module, a
WebGL smoke test). Open them through any static server started at the repo root, for example
`python3 -m http.server 8765`, then `http://127.0.0.1:8765/.design-dev/harness/stage.html`.
`tests/unit/fixtures/font-advances.json` holds glyph widths for the four fonts so the layout tests give
the same answers in Node as in the browser. Regenerate it with `pip install fonttools brotli` and then
`python3 scripts/font-advances.py` if the fonts change.
