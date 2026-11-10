# Brief to proof pictures

A dev-only command that turns a proof brief (the plan a person or a bot writes for one customer's order) and the
customer's real logo files into the pictures a proof request carries, and checks the design the way the Designer does.
The brief says what goes on every panel. The Designer does the drawing and the measuring.

It builds the design in the Designer itself (headless Chromium, the real fonts, the real model code), so text fits,
safe areas and the turned panels of a table throw are exactly what a customer would get. It never sends anything: every
request that is not to the local copy of the site is refused, and so is `/api`.

```
cd .design-dev
npm run proof -- --brief scripts/proof-from-brief/examples/honeydrop-throw.json \
                 --logos scripts/proof-from-brief/examples \
                 --out out/proof-demo
```

`stdout` is one JSON object (the result). Plain words go to `stderr`.

| Option | |
|---|---|
| `--brief` | The brief, or the bot's whole reply (`{"status":"ready","brief":{...}}`). |
| `--logos` | A folder with the customer's logo files, named as in `brief.logos`. Needed when the brief lists logos. |
| `--out` | Where to write the files. Created if needed. |
| `--strict` | Exit 4 when a check fails or anything needs a look. |

Exit codes: `0` done, `1` bad brief or bad usage, `2` the reply was not `ready`, `3` the render failed, `4` `--strict` and something needs a look.

## What it writes

| File | What |
|---|---|
| `previews/preview-<n>-<product>-<panel>.png` | The pictures the proof request would carry, with the same names: for a table throw the whole flat first (ends and back turned the way they print), then each panel as it reads on the table. One picture per side for other products. |
| `design.json` | The Designer's v2 design, checked with the same `validateDocument` the proof request goes through. |
| `report.json` | The checks, the numbers behind them, and what needs a look (below). |
| `summary.txt` | What is on each panel, in the words of the proof email, and the checks. |
| `brief.json` | The brief as the tool read it (defaults filled, hex codes in capitals, side names as the catalog spells them). |

## The checks

`report.checks` has four keys, the ones the proof bot lists in its own `checks`. Each is `pass`, `fail` or `n/a`.

| Key | Fails when | From |
|---|---|---|
| `safe_area` | text or a logo reaches past the safe area | the Designer's review rules (`model/review.js`) |
| `min_text_size` | a line is shorter than the product's minimum letter height | same |
| `logo_sharpness` | a PNG, JPG or WebP logo is below the amber dpi at the size it is placed. `n/a` when every logo is a vector | same, with the dpi worked out per logo |
| `contrast` | text is under 3 to 1 against what is behind it | same |

`report.attention` is the list of plain sentences for a person: every failed check with its panel, a soft (amber) logo, a
word that no panel prints (a phone number with no phone line on the template), an empty logo frame, a logo in the brief
that is on no panel, a panel left for a manual layout, and a logo the brief calls vector that is not. `verdict` is
`clean` when that list is empty. The rest of `report.json` has the numbers: `text_sizes` (letter height against the
minimum, per line), `logos` (pixels, placed width, dpi, level), `unplaced_fields`, `empty_logo_frames`, `manual`,
`pieces` (what is on each panel), `previews` (file, label, width, height), `blocked_requests` and `page_problems`
(both should be empty).

## The brief

```json
{
  "customer": "Honeydrop Apiary",
  "proof_no": 1,
  "date": "2026-11-10",
  "palette": { "primary": {"name": "Honey gold", "hex": "#F6C445"}, "accent": {"name": "Charcoal", "hex": "#1F1A17"}, "ink": {"name": "Charcoal", "hex": "#1F1A17"} },
  "fields": { "name": "HONEYDROP", "line2": "APIARY", "phone": "", "web": "" },
  "font": null,
  "logos": [{ "file": "honeydrop-logo.svg", "vector": true }],
  "pieces": [{
    "product": "throw", "options": {"length": "6", "style": "4"}, "qty": 1,
    "template": "bold-center", "sides_mode": "each",
    "panels": [
      {"side": "Front", "use": "template"},
      {"side": "Top", "use": "logo"},
      {"side": "Left end", "use": "text", "lines": ["HONEYDROP"]},
      {"side": "Right end", "use": "text", "lines": ["HONEYDROP"]},
      {"side": "Back", "use": "text", "lines": ["HONEYDROP"]}
    ]
  }]
}
```

`brief.mjs` checks all of this against the catalog, so a product, option, template or side that does not exist fails with
its path (`pieces[0].panels[4].side`) and a plain message. Every mistake is reported at once. A brief that is not
`ready` is not rendered. A reply may carry other fields (`summary`, `flags`, `mockup_prompt`, ...); they are ignored.

- `product`, `options`, `template`: ids from `assets/design/catalog.json`. Every option of the product is needed. A product with no quantity (yard signs, decals, safety signs: the pack sets the count) has `qty` 1.
- `sides_mode`: `each` for a table throw (its panels are different pieces). `same` or `each` for products with several sides. A product with one side is just that side.
- `panels`: one per side, named as the catalog names them (`Front`, `Top`, `Left end`, `Right end`, `Back`, `Right`, `Left`, `Sign 3`, ...). In `same` mode, the first side only. A 3-sided throw has no `Back`, a fitted cover has `Front` only.
- `use`:

| `use` | Puts on the panel |
|---|---|
| `template` | The template, with `fields`. Any logo frame it has gets the logo (the first one, or `logo_file`). A table throw's template is the `Front` only. |
| `text` | 1 to 3 `lines`, centered in the panel's safe area, each line as big as it fits. |
| `logo` | The logo, as big as fits the safe area. `logo_file` says which when there is more than one. |
| `logo_and_text` | Both: side by side on a wide panel, stacked on a squarer one. |
| `plain` | The background only. |
| `custom` | Nothing yet. The panel is left plain and listed in `report.manual` with its `note`, for a person to lay out by hand. |

On a canopy the logo and words go in the gable's own block (the widest box that fits the safe line), on a feather flag in
the body band, the same regions the templates use. A panel's `bg` (`primary`, `accent`, `ink` or a hex) sets its
background, and its words use the ink color unless that does not read, then the palette color that does.

## Using it in a loop

1. Save the bot's reply to a file and run the tool on it.
2. Exit `1`: send `errors` (each has a `path` and a plain `message`) back to the bot and let it fix the brief. Exit `2`: the bot asked a question or escalated, so there is nothing to draw.
3. Exit `0`: put `report.checks` into the reply's `checks`, add `report.attention` to its `flags`, and hand the pictures and `summary.txt` to the person who reviews the proof. If a line is too small, the bot can split it onto two lines or shorten it and run the tool again.

## How it works

`cli.mjs` checks the brief, starts the local file server and Chromium from `tests/e2e/helpers.mjs`, opens the
Designer page for the first piece's product, and calls `run()` in `in-page.mjs`. That builds the design with
`createDocument`, the templates, `addLogoFile` (the Designer's own upload code, which cleans SVG) and `placeLogo`, runs
`collectWarnings`, and calls `proof.buildPreviews()`, the very function the proof request uses. The one change to the
Designer itself is that `assets/design/app.js` now lists `proof` on the `window.GSSDesigner` test hook, next to `store`
and `stage`.

## What it does not do

The photo mockup (a blank product photo with the real logo placed on it) and the 17 x 11 proof sheet are separate steps.
The pictures here are the flat art that prints.
