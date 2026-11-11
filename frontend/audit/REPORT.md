# ManagerXP website: hero rebuild and site audit (2026-11-10)

Checkpoint before any change: commit `be374d9` on `feature` (local, not pushed).
Screenshots: `audit/before/` and `audit/after/` (homepage at 1920, 1440, 1366, 1024, 768, 390 wide; full-page at 1440 and 390; two live frames of the 3D scene at 1366).
Lighthouse JSON: `audit/before/lighthouse-*.json`, `audit/after/lighthouse-*.json` (production build, `vite preview`).

## Lighthouse

| Run | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| Desktop, before | 97 | 100 | 100 | 100 | 0.7 s | 1.1 s | 0 ms | 0.054 |
| Desktop, after | **100** | 100 | 100 | 100 | 0.3 s | 0.6 s | 20 ms | **0** |
| Mobile, before | 93 | 100 | 100 | 100 | 1.5 s | 3.0 s | 120 ms | 0 |
| Mobile, after | 93 (84-93 across runs) | 100 | 100 | 100 | 1.1 s | 2.8 s | 180 ms | 0 |

Mobile scores moved between 90 and 93 across runs of the same build on this machine (TBT is CPU-load noise). Mobile LCP is unchanged; see "Left" below.

## The hero

- Two columns from 1024 px: headline, hairline rule, intro and both CTAs on the left; the 3D scene on the right, bleeding 3vw past the content edge. The headline size is unchanged.
- At 1366x768 the whole hero (and the top of the next section) fits the first screen. Primary CTA bottom edge per width, viewport height in brackets: 1920: 602 (1080), 1440: 584 (900), 1366: 563 (768), 1024: 466 (768), 768: 407 (1024), 390: 414 (844).
- Phones and tablets: stacked; the scene becomes a still poster placed after the CTAs, so it can never push them down.

### The 3D scene (`src/lib/scenes/india3d.js`, runner `src/lib/scene3d.js`, `src/components/site/HeroScene.jsx`)

Replaced several times at the owner's request (receipt loop; modules, chip and cube options; a dot-matrix network map, judged "AI-looking"). Final: the owner's brief for a fully 3D, interactive India map.

- A regional 3D map framed on ManagerXP's two bases: India as a solid slab (white top, black sides) with the Andaman & Nicobar Islands as island shapes, neighbouring land (Sri Lanka, Bangladesh, Myanmar) lower and grey, edges fading into the page. Outline in `src/lib/indiaOutline.js`, hand-written to follow India's official boundary. **Check it against the Survey of India map before launch.**
- One connection only: Hyderabad to Andaman, both red pins labelled "ManagerXP base · active clients" (names only on narrow views), each with a cluster of client nodes. A GSAP cycle sends a pulse along the route that bursts on arrival and lights the clients there, then a reply comes back.
- GSAP entrance (land rises, pins drop, route draws), then the connection cycle repeats. Interaction: drag to turn (gentle limits), hover a pin to lift it, click to fly the camera to it; click elsewhere, Escape, or 7 idle seconds to return; slow drift when left alone.
- three.js + GSAP chunk: 616 KB, 171 KB gzipped, lazy-loaded after first paint on capable desktops only. Capable desktops show no poster (the entrance is the reveal); phones, reduced motion, Save-Data, no or software WebGL, low-power devices and slow frames get a 25 KB still poster rendered from the finished scene at phone scale.
- 61 fps on the real GPU (NVIDIA GTX 1650), no console errors.

## Findings

Severity: P0 blocks use, P1 major or WCAG AA failure, P2 minor, P3 polish.

| # | Finding | Sev | Status |
|---|---|---|---|
| 1 | Hero right half empty; content centred in a full-height box left a band above the headline | P1 | Fixed (two-column hero, 3D scene) |
| 2 | FlowXP described as "AI-powered business management" everywhere; it is restaurant billing software | P1 | Fixed in products data (nav, rows, footer), FAQ, About, Products SEO, PRODUCT.md, plan doc |
| 3 | FlowXP module list claimed "AI insights"; FlowXP's AI module is not built | P1 | Fixed (now Billing, GST invoices, Payments, Stock, Reports) |
| 4 | 3D scene on a software-rendered browser: 11 s of main-thread blocking (desktop score 58 in a first attempt) | P1 | Fixed (software-WebGL check plus frame-time watchdog) |
| 5 | Nav wrapped onto two lines at 1024-1279 px ("Custom Development", "Sign in", "Let's build together") | P1 | Fixed (no-wrap labels, tighter gaps below 1280) |
| 6 | Red hover text 3.9:1 on the light sheet and 4.4:1 on black (under AA) on 15 links | P1 | Fixed once in CSS: background-aware hover red (4.98:1 light, 5.3:1 dark) |
| 7 | Google Fonts stylesheet render-blocking, fonts from a second origin | P2 | Fixed (self-hosted via Fontsource, headline face preloaded) |
| 8 | Logos and Startup India badge as oversized PNG; badge had no dimensions | P2 | Fixed (WebP, 50-67% smaller; badge sized and lazy) |
| 9 | Em/en dashes in visible public and sign-in copy (24 strings) | P3 | Fixed |
| 10 | Vite chunk-size warning on every build | P3 | Fixed (limit set just above the lazy 3D chunk) |
| 11 | ManagerXP spelling; hotel or travel claims | - | Checked: none wrong |
| 12 | Contrast, focus ring, heading order, alt text, Products dropdown keyboard | - | Checked: pass (Lighthouse a11y 100 before and after; dropdown arrow keys and Escape verified earlier) |
| 13 | Sideways scroll, oversized headings, text under 11px, JS errors on 14 pages x 6 devices | - | Pass: Playwright 98 passed, 4 skipped (nav check on phone/tablet sizes) |

## Left, and why

- **Mobile LCP 3.0 s** (target 2.5 s) under Lighthouse's slow-4G simulation. The page is rendered by JavaScript, so nothing paints until the bundle runs; it was 3.0 s before this work too. The real fix is prerendering the marketing pages to static HTML, a bigger change worth its own task.
- **Three CTAs with the same "contact" intent**: nav "Let's build together", hero "Build with ManagerXP", closing "Let's build it." The taste rule says one label per intent, but nav labels and CTA copy are yours to change, so I did not rename them.
- **Duplicate libraries in the signed-in legacy screens** (not loaded on the public site): `react-hot-toast` and `react-toastify` (one file each), `axios` alongside `fetch` (2 files), `animejs` alongside `framer-motion` (2 mockups), `date-fns` (2 files), `react-icons` for two footer icons. Consolidating means editing the legacy admin and café-manager screens, which are kept for features the new console lacks. Possible cut: 4-5 dependencies.
- **CSS bundle 134 KB (44 KB gzipped)**: one Tailwind bundle for the public site and both dashboards. Splitting it per area would trim what the homepage downloads; not done.
