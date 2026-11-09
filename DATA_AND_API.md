# LocalHub Kazakhstan: application and data architecture

## Hosting

The public application is a static multi-page site served by Vercel. Vercel discovers CommonJS handlers in `api/` as Node serverless functions. `vercel.json` adds short routes for the auth, categories, account, and admin HTML pages. A plain static web server can render catalog pages, but it cannot run the `/api/*` endpoints.

## Supabase configuration

Set these Vercel environment variables without placing values in source control:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (the legacy `SUPABASE_ANON_KEY` is accepted as a fallback)
- `SUPABASE_SERVICE_ROLE_KEY` (server only; currently required for validated submission writes and Auth Admin operations)
- `DGIS_API_KEY` (server only, used by `api/places.js`)

`api/supabase-config.js` returns only the URL and publishable key. `lib/supabase-server.js` verifies bearer tokens against Supabase Auth and reads the service role key only in server functions. Never put the service role key in a browser bundle or share it in support messages.

The Supabase JavaScript SDK is loaded from jsDelivr at the pinned version `2.118.0`. Auth sessions are persisted by Supabase JS in browser storage. Cloud favorites and searches are cached under per-user LocalStorage keys; guest data uses separate guest keys. Signing out switches the UI to the guest namespace and does not delete database rows.

## Database setup

Apply migrations in filename order:

1. `supabase/migrations/20261104000000_localhub_platform.sql`
2. `supabase/migrations/20261104010000_submission_gateway_and_admin_audit.sql`
3. `supabase/migrations/20261106000000_admin_only_live_role.sql`
4. `supabase/migrations/20261106110000_collections_comparisons_reports.sql`
5. `supabase/migrations/20261106120000_badges_ads_analytics.sql`

The first migration creates categories, profiles, the published organization catalog, favorites, saved searches, search history, submissions, moderation events, role helpers, RLS policies, and the review/dashboard RPCs. The second migration removes direct client INSERT permission on submissions, grants server-role insert access, adds catalog audit triggers, and adds the server-only audit RPC for Auth Admin actions.

RLS is required for every table exposed through Supabase Data API. The browser writes only user-owned favorites, saved searches, and search history. Organization submissions are created only through `POST /api/submissions`; the function verifies the user's access token, validates fields, enforces its per-instance request limit, sets `user_id` from the verified user, and inserts using the server-only key. Do not grant `authenticated` INSERT on `organization_submissions` again.

The only privileged role is `admin`. Server routes verify the user through Supabase Auth and allow administrative actions only when the current `app_metadata.role` is `admin`. Database RLS and RPC role helpers read the current `auth.users.raw_app_meta_data` for `auth.uid()` through a narrowly scoped `SECURITY DEFINER` function, so a previously issued JWT cannot preserve admin rights after the role is removed. Existing `moderator` values are left unchanged and treated as ordinary users; no user rows are mass-updated. Clients cannot write `app_metadata`; a first admin must be provisioned out of band by a trusted project owner. Admin API role and block actions are recorded in `moderation_events`; category and organization mutations are logged by database triggers; moderation decisions are logged by the review RPC.

## Platform extensions

Migration `20261106110000_collections_comparisons_reports.sql` adds per-user collections and items with owner/public RLS, fields used in organization comparison, a private report queue, a server-only report submission RPC with an advisory-lock per-user hourly cap, and an admin-only review RPC with an append-only event trail. Submit a complaint through `POST /api/reports`; the browser never receives service-role credentials. Public collections are read-only, private collections are owner-only, and write policies bind to `auth.uid()`. Column-level SELECT grants omit `business_collections.owner_id` from Data API responses.

Organization comparison is device-local and limited to four IDs. It uses published catalog data and displays unknown values as “Не указано”; no ratings, prices, or services are generated. `description`, `price_summary`, and `services` are optional organization fields.

Migration `20261106120000_badges_ads_analytics.sql` adds admin-managed organization badges with evidence/source and optional expiry, manually managed ad campaigns, server-side campaign counters, manually confirmed business owners, and aggregate event analytics. Badge visibility is time-bounded by RLS; the `new` badge validates against the existing `organizations.published_at` column. “Реклама” is displayed only for an active ad campaign; it is not an assignable badge. Ad destinations and image URLs require HTTPS; the campaign system has no billing or behavioral targeting. Public column grants omit badge assigner IDs and ad campaign creator IDs/counters. Business owners are assigned by an administrator after an out-of-band identity check; ownership claims are never accepted from the browser.

`POST /api/analytics` accepts a small action vocabulary and hashes a browser-generated random session identifier with the server-only service-role key. It stores no IP address or raw session token. A best-effort in-memory per-instance request limit and database deduplication reduce repeat inflation, but neither is a distributed anti-fraud system. `GET /api/analytics?organizationId=...` requires authentication and the database verifies current admin or confirmed ownership. Analytics are aggregates and the server never returns other users' browsing history.

Migration `20261107100000_site_analytics.sql` adds site-wide page views with separate browser visitor and session hashes, a 30-minute per-page deduplication bucket, personal notifications, organization verification requests, business claim requests, and a city-count RPC for the map. `POST /api/site-analytics` accepts a small allowlist of LocalHub paths and hashes browser-generated random IDs with the server-only Supabase service key; it does not persist IP addresses, referrers, query strings, or raw IDs. The administrator-only `GET /api/site-analytics` summary reports views, visits, distinct browser IDs for today, 7 days, and 30 days, popular pages and organizations. Browser IDs are device/browser identifiers, not verified human identities. Migration must be applied before these endpoints and UI can return data.

`record_organization_view` replaces an existing organization view for the same account before recording a new one, keeping the account history bounded by unique organizations. Guest organization history is stored locally, deduplicated by organization ID, and capped at 100 entries.

The ownership workflow accepts a claim with contact information and an HTTPS evidence link. Only an administrator review RPC can add the requester to `business_owners`. A confirmed owner can then submit an HTTPS verification evidence link; only administrator approval can apply the verified badge. Submission, ownership, and verification decisions create personal notifications. Notifications are private under RLS, and users can only change the read timestamp or delete their own entries.

`GET /api/ads?placement=...` returns only active, in-date campaigns. `POST /api/ads` increments counters through a restricted service-only RPC; client requests cannot set counters. A database uniqueness key deduplicates events by campaign, event type, HMAC-derived requester hash, and hour across serverless instances; stale deduplication hashes older than the recent window are removed during event writes. This raises the cost of replay but does not provide full bot/fraud prevention. Campaign data is edited through admin API actions, with a database audit trigger. Admin API routes validate the current database role through `current_app_role()` rather than trusting an old JWT role claim.

The language selector persists `ru`, `kk`, or `en` in LocalStorage. Translation strings are centralized in `i18n.js`; organization names and other business-provided facts are never machine-translated. The shared navigation, catalog category labels, and key search labels are translated; many legacy forms, admin messages, and new-page descriptions still fall back to Russian, so full three-language coverage is not complete.

City/category SEO routes are backed only by currently published catalog rows. `/city/:slug` and `/:city/:category` reject unknown slugs and are marked `noindex` when there are no matching organizations. `/sitemap.xml` is generated from existing city/category combinations; it does not emit empty combinations. The current HTML architecture applies page metadata client-side, so reliable server-rendered metadata for crawlers would require SSR/prerendering.

## Auth setup

Configure the Supabase Auth Site URL and allowed redirect URLs for the deployed domain, including `/login` and `/update-password`. Configure email delivery and confirmation policy in the Supabase project. For local end-to-end auth/API testing, use `vercel dev` with a private local `.env.local`; a static server alone does not exercise these routes.

## Catalog and provider data

`businesses.json` intentionally contains no sample businesses. Published LocalHub organization records live in Supabase and are separate from transient 2GIS responses. Approved user submissions become LocalHub records; 2GIS search results are not persisted automatically.

`api/places.js` reads `DGIS_API_KEY` only on the server and calls 2GIS Places API. Its in-memory limit (10 requests per minute per warm function instance, five pages, ten records per page) is best effort. It is not a shared distributed quota and can be bypassed across serverless instances. Before production traffic, consider Vercel-level rate limiting or a shared store such as Redis/Upstash; no external rate-limit service is configured by this project.

`/assistant` is an optional AI search interface backed by `POST /api/assistant`. Configure the server-only `OPENAI_API_KEY`; `OPENAI_MODEL` can override the default model. The server asks for a strict structured search intent, validates city/category against LocalHub's allowlists, and queries Supabase itself; only database rows are returned as organization cards. The browser stores a short chat history in local storage. If the key is absent the endpoint returns a setup error and does not display sample results. The user message and short recent conversation are sent to OpenAI with response storage disabled.

Leaflet uses OpenStreetMap tiles without an API key, with attribution and a cross-origin referrer policy. Do not increase tile request volume or proxy OSM tiles. The map uses `/api/map?mode=cities` for real city counts and `/api/map?bbox=...` to fetch only the visible area; requests are bounded and rate limited. It renders LocalHub organizations, while 2GIS search results remain transient and are not imported automatically. These map APIs depend on the new city-count migration RPC.

## Local data

Guest favorites and saved searches are stored locally under guest-specific keys. Signed-in account caches are namespaced by Supabase user ID and are refreshed from the database. Display preferences and the list of locally-added cities remain device-local. Guest submissions remain drafts on that device; authenticated submissions are sent to the moderation queue. The old unscoped favorites/search cache keys are cleared because they cannot be safely attributed to a guest or a particular account; this does not delete database rows.
