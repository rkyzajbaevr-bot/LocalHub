"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migrations = fs.readdirSync(path.join(root, "supabase", "migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => fs.readFileSync(path.join(root, "supabase", "migrations", name), "utf8"))
  .join("\n");

test("authenticated request inserts cannot set moderation metadata", () => {
  const verification = migrations.match(/create table public\.organization_verification_requests\s*\([\s\S]*?\n\);([\s\S]*?)create or replace function public\.notify_submission_decision/i)?.[1] || "";
  const claims = migrations.match(/create table public\.business_claim_requests\s*\([\s\S]*?\n\);([\s\S]*?)create or replace function public\.review_business_claim_request/i)?.[1] || "";
  assert.match(verification, /grant insert\s*\(organization_id,\s*user_id,\s*evidence_url\)\s+on public\.organization_verification_requests to authenticated/i);
  assert.match(verification, /review_note is null and reviewed_by is null and reviewed_at is null/i);
  assert.match(claims, /grant insert\s*\(organization_id,\s*user_id,\s*contact_name,\s*contact_phone,\s*evidence_url\)\s+on public\.business_claim_requests to authenticated/i);
  assert.match(claims, /review_note is null and reviewed_by is null and reviewed_at is null/i);
});

test("every API RPC call has a matching SQL function definition", () => {
  const apiDir = path.join(root, "api");
  const called = new Set();
  for (const name of fs.readdirSync(apiDir).filter((file) => file.endsWith(".js"))) {
    const source = fs.readFileSync(path.join(apiDir, name), "utf8");
    for (const match of source.matchAll(/\/rest\/v1\/rpc\/([a-z0-9_]+)/g)) called.add(match[1]);
  }
  for (const rpc of called) {
    assert.match(migrations, new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${rpc}\\s*\\(`, "i"), `No migration defines RPC ${rpc}`);
  }
});

test("active campaign rows remain visible only to anon and admins", () => {
  const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "20261109120000_ad_campaign_metrics_admin_only.sql"), "utf8");
  const original = fs.readFileSync(path.join(root, "supabase", "migrations", "20261106120000_badges_ads_analytics.sql"), "utf8");
  assert.match(migration, /alter policy ad_campaigns_read_active\s+on public\.ad_campaigns to anon\s+using \(status = 'active'[\s\S]*?\)/i);
  assert.doesNotMatch(migration, /to anon,\s*authenticated/i);
  const policies = [...migrations.matchAll(/(?:create|alter)\s+policy\s+\w+[^;]*?on\s+public\.ad_campaigns\b[^;]*;/gi)];
  assert.deepEqual(policies.map((match) => match[0].match(/(?:create|alter)\s+policy\s+(\w+)/i)[1]).sort(), ["ad_campaigns_admin_manage", "ad_campaigns_read_active", "ad_campaigns_read_active"]);
  assert.match(original, /alter table public\.ad_campaigns enable row level security/i);
  assert.match(original, /create policy ad_campaigns_admin_manage\s+on public\.ad_campaigns for all to authenticated\s+using \(public\.is_admin\(\)\)/i);
  assert.match(original, /grant select, delete on public\.ad_campaigns to authenticated/i);
  assert.match(original, /grant select \(id, name, organization_id, placement, image_url, destination_url, city, category_id, starts_at, ends_at, status, created_at\)\s+on public\.ad_campaigns to anon/i);
  assert.doesNotMatch(original, /grant select\s*\([^)]*(?:impressions|clicks|created_by)[^)]*\)\s+on public\.ad_campaigns to anon/i);
  assert.match(original, /revoke all on function public\.record_ad_campaign_event\(uuid, text, text\) from public, anon, authenticated, service_role/i);
  assert.match(original, /grant execute on function public\.record_ad_campaign_event\(uuid, text, text\) to service_role/i);
});

test("migration files leave transaction boundaries to the Supabase migration runner", () => {
  const directory = path.join(root, "supabase", "migrations");
  const pending = new Set(["20261107100000_site_analytics.sql", "20261109120000_ad_campaign_metrics_admin_only.sql"]);
  for (const name of fs.readdirSync(directory).filter((file) => pending.has(file))) {
    const source = fs.readFileSync(path.join(directory, name), "utf8");
    assert.doesNotMatch(source, /^\s*(?:begin|commit)\s*;\s*$/im, `${name} embeds transaction control`);
  }
});
