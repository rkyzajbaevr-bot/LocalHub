-- Public active ads remain available through the anon role. Authenticated
-- non-admins must not inherit that row policy because their table SELECT grant
-- also includes private counters. Admins retain full access via the existing
-- authenticated admin policy and existing API endpoint.
alter policy ad_campaigns_read_active
  on public.ad_campaigns to anon
  using (status = 'active' and starts_at <= now() and ends_at > now());

