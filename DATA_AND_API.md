# LocalHub Kazakhstan: data and integrations

The static front end reads `businesses.json` (`schemaVersion: 1`, `businesses: []`). Empty data is intentional; no sample businesses or unverified ratings are bundled.

Each business record supports: `id` (unique string), `name`, `category` (one of the category IDs in `script.js`), `city`, optional `region`, `address`, optional numeric `lat` and `lon`, `phone`, `website`, `photo`, `source`, `updatedAt` (ISO date), optional `hours`, and optional `rating` with `ratingSource`. Ratings are displayed only when both a rating and its source are present. Missing fields display “Не указано”.

The add form stores user submissions in browser `localStorage` under `localhub:pending`; this is a local intake queue and does not publish into the shared directory. Favorites use `localhub:favorites`.

## Production data architecture

Use a server-side API (for example Node.js + PostgreSQL/PostGIS) for moderated submissions, bulk imports, deduplication by provider ID/coordinates/name, source provenance, and update history. Serve normalized records to the static client through `/api/businesses`. Keep provider credentials in server environment variables. Implement separate server adapters for 2GIS and Yandex Maps, respecting each provider's terms and attribution requirements. Do not put secret keys in browser JavaScript. Yandex/2GIS map rendering and provider imports require provider accounts, API credentials, server-side integration and licensing review.

For bulk import, validate JSON Lines or CSV against the schema, normalize category and city names, require a source and update date, reject duplicate IDs, and stage records for review before publication. The current static client can use a generated `businesses.json` export.

## Running locally

Because the browser fetches JSON, serve this directory over HTTP (for example `python -m http.server 8000`) and open `http://localhost:8000`. Opening `index.html` as a `file://` URL may block the JSON fetch.

## 2GIS Places API test search

The map page includes an on-demand search wired to the Vercel Function `api/places.js`. It sends only the selected city, LocalHub category, and page to the same-origin endpoint. The function reads `DGIS_API_KEY` from the server environment, calls Places API 3.0 `/3.0/items`, and returns only the provider's ID, name, address, WGS84 point, and source. No key is returned to the browser. Search results and selections remain in memory for the current page session; they are not written to `businesses.json`, LocalStorage, or a database.

For a no-subscription test, use a 2GIS demo key if you have one. Configure `DGIS_API_KEY` in the Vercel project environment variables, then redeploy. Do not put the key in front-end code or commit a `.env` file. Without that environment variable the endpoint returns a clear `api_key_missing` message. The test endpoint allows at most 10 requests per minute per warm function instance, 10 results per page, and five pages. The in-memory rate limit is best-effort because Vercel may run multiple serverless instances.

Deploy the project to Vercel (the `/api` directory is discovered as serverless functions) or run it locally with Vercel CLI (`npx vercel dev`). A plain static server such as `python -m http.server` serves the pages but does not run `/api/places`. 2GIS text search uses the selected category and city as the documented textual geographic restriction. Check the applicable 2GIS API terms and key entitlements before retaining, exporting, or bulk importing results. The current search flow does not persist provider data.


## Local account features

The account page (`account.html`) is device-local and has no registration or identity verification. Favorites, saved searches (maximum 30), and display preferences use separate LocalStorage keys. Saved searches can restore the catalog query, category, city, region, and sort order. Browser storage can be cleared and does not synchronize between devices.

2GIS search results are transient and are not written to favorites, saved searches, LocalStorage, or `businesses.json`. Persisting provider records requires review of 2GIS retention and display terms first.