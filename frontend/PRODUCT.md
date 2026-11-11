# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Business owners and operators** evaluating a technology partner: they run operations that off-the-shelf software fits badly and want to know whether ManagerXP can build or supply the system they need.
- **Enterprise / technology decision-makers and partners** assessing engineering capability before starting a conversation.
- **Gaming café and sim-racing venue owners** looking specifically for CafeXP or RaceXP (existing audience, now one of several).
- Signed-in café owners, staff and ManagerXP admins also use this same app (dashboard, store console, admin) — those surfaces are out of scope for the marketing redesign and keep their own chrome.

## Product Purpose

ManagerXP Private Limited is an AI-powered business technology company. It builds intelligent software products and custom technology solutions that simplify operations, automate complex workflows, and help businesses scale. The marketing site must make a first-time visitor understand, within one viewport, that ManagerXP is a technology company (products + custom engineering), not only a gaming-café software vendor. Success = visitors start a conversation (contact / project enquiry) or go deeper into a product.

## Positioning

A small engineering company that ships its own operational products in demanding real-time environments (live PC sessions, billing against the clock, multi-branch staff, telemetry) and applies that same engineering to clients' custom systems. The products are the proof of the engineering.

## Operating Context

- Contact and Book-a-Demo forms post to the backend SMTP mailer (`src/lib/contactEmail.js`); must keep working.
- CafeXP: shipping product, 15-day trial on up to 5 PCs, no card (`/signup`). Packages Basic / Pro / Elite (`PricingPlans`).
- RaceXP: sim-racing technology, **in development** (confirmed 2026-11-04) — gets its own page, always labelled In development.
- FlowXP: restaurant billing software (restaurants only, not hotels or travel), external site `https://flowxp.in`, always opens in a new tab. Its AI module is not built yet, so the site does not claim AI features for it.

## Capabilities and Constraints

- Stack: React 19 + Vite 7 + Tailwind v4 + framer-motion + lucide-react (existing; do not migrate).
- Confirmed IA decisions (2026-11-04): one new `/solutions` page (Custom Development = a section of it); CafeXP page at `/products/cafexp`, RaceXP at `/products/racexp`; nav keeps a quiet "Sign in" link with primary CTA "Let's Build Together" → contact; free trial lives on the CafeXP page.
- Capability areas offered (target, not proven deployments): AI products, custom software engineering, intelligent automation, system integration, data & operational intelligence, digital product development.
- Industries are target sectors, never claimed deployments.

## Brand Commitments

- Names: ManagerXP, ManagerXP Private Limited, CafeXP, RaceXP, FlowXP.
- Assets: `src/assets/whitelogo-sm.png`, `logo.png`, `icon.png`, `startupIndiaBadge.png` (DPIIT Startup India recognition).
- Brief-pinned palette: deep charcoal/black, neutral grays, white type, ManagerXP red as a deliberate accent (not everywhere). Maximum two font families.
- Voice: premium, intelligent, bold, precise. No "passionate about innovation" filler; every statement carries a tangible value.

## Evidence on Hand

- Real contact info: managerxp2026@gmail.com, +91 9679549136, 8-2-644/1/205 F205, Hiline Complex, Road No.12, Banjara Hills, Hyderabad 500034. LinkedIn `linkedin.com/company/managerxp`, Instagram `instagram.com/manager.xp`.
- Founders: Abdul Hayyu (Founder), Mubashir Lone (Co-Founder), Hyderabad (About page bios).
- Startup India / DPIIT recognition badge.
- Working interactive CafeXP product mockups (CommandCenter, StationOps, BillingDesk, PeopleOps, FnbInventory, AnalyticsPeak, CafeXPAI) and RaceXP telemetry preview.
- **Absent — never fabricate:** client logos, testimonials, case studies, customer counts, certifications, uptime/benchmark figures, enterprise deployments.

## Product Principles

1. The products are the proof — show working software, not claims.
2. Company first, products second: ManagerXP is the engineering company; CafeXP/RaceXP/FlowXP are what it has built.
3. Honest status: in-development is labelled, targets are framed as targets.
4. One clear next step on every page: start a conversation.

## Accessibility & Inclusion

Keyboard navigable (skip link, focus-visible rings, dropdown/menus with Escape and focus management), `prefers-reduced-motion` honoured globally via `MotionConfig reducedMotion="user"`, WCAG AA contrast on the dark ground.
