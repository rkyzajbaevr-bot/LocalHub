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

The first migration creates categories, profiles, the published organization catalog, favorites, saved searches, search history, submissions, moderation events, role helpers, RLS policies, and the review/dashboard RPCs. The second migration removes direct client INSERT permission on submissions, grants server-role insert access, adds catalog audit triggers, and adds the server-only audit RPC for Auth Admin actions.

RLS is required for every table exposed through Supabase Data API. The browser writes only user-owned favorites, saved searches, and search history. Organization submissions are created only through `POST /api/submissions`; the function verifies the user's access token, validates fields, enforces its per-instance request limit, sets `user_id` from the verified user, and inserts using the server-only key. Do not grant `authenticated` INSERT on `organization_submissions` again.

The only privileged role is `admin`. Server routes verify the user through Supabase Auth and allow administrative actions only when the current `app_metadata.role` is `admin`. Database RLS and RPC role helpers read the current `auth.users.raw_app_meta_data` for `auth.uid()` through a narrowly scoped `SECURITY DEFINER` function, so a previously issued JWT cannot preserve admin rights after the role is removed. Existing `moderator` values are left unchanged and treated as ordinary users; no user rows are mass-updated. Clients cannot write `app_metadata`; a first admin must be provisioned out of band by a trusted project owner. Admin API role and block actions are recorded in `moderation_events`; category and organization mutations are logged by database triggers; moderation decisions are logged by the review RPC.

## Auth setup

Configure the Supabase Auth Site URL and allowed redirect URLs for the deployed domain, including `/login` and `/update-password`. Configure email delivery and confirmation policy in the Supabase project. For local end-to-end auth/API testing, use `vercel dev` with a private local `.env.local`; a static server alone does not exercise these routes.

## Catalog and provider data

`businesses.json` intentionally contains no sample businesses. Published LocalHub organization records live in Supabase and are separate from transient 2GIS responses. Approved user submissions become LocalHub records; 2GIS search results are not persisted automatically.

`api/places.js` reads `DGIS_API_KEY` only on the server and calls 2GIS Places API. Its in-memory limit (10 requests per minute per warm function instance, five pages, ten records per page) is best effort. It is not a shared distributed quota and can be bypassed across serverless instances. Before production traffic, consider Vercel-level rate limiting or a shared store such as Redis/Upstash; no external rate-limit service is configured by this project.

Leaflet uses OpenStreetMap tiles without an API key, with attribution and a cross-origin referrer policy. Do not increase tile request volume or proxy OSM tiles. The map only renders LocalHub records with coordinates and 2GIS markers returned for the current search session.

## Local data

Guest favorites and saved searches are stored locally under guest-specific keys. Signed-in account caches are namespaced by Supabase user ID and are refreshed from the database. Display preferences and the list of locally-added cities remain device-local. Guest submissions remain drafts on that device; authenticated submissions are sent to the moderation queue. The old unscoped favorites/search cache keys are cleared because they cannot be safely attributed to a guest or a particular account; this does not delete database rows.
