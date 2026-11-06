begin;

-- Read the current server-managed role instead of the potentially stale JWT claim.
-- auth.uid() supplies only the identity from the verified request token; callers
-- cannot choose another user's ID or write auth.users.raw_app_meta_data.
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when u.raw_app_meta_data ->> 'role' = 'admin' then 'admin'
        else 'user'
      end
      from auth.users as u
      where u.id = (select auth.uid())
    ),
    'user'
  );
$$;

-- Keep helper execution limited to the API roles that use it in RLS policies.
revoke all on function public.current_app_role() from public, anon, authenticated, service_role;
grant execute on function public.current_app_role() to anon, authenticated;

revoke all on function public.is_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_admin() to anon, authenticated;

-- Staff-only reads now mean admin-only reads.
drop policy if exists submissions_read_staff on public.organization_submissions;
create policy submissions_read_staff
  on public.organization_submissions
  for select to authenticated
  using (public.is_admin());

drop policy if exists moderation_events_staff_read on public.moderation_events;
create policy moderation_events_staff_read
  on public.moderation_events
  for select to authenticated
  using (public.is_admin());

-- Retain the existing SECURITY DEFINER behavior, validation, transaction,
-- audit event, and authenticated-only EXECUTE grant; require current admin.
create or replace function public.review_organization_submission(
  p_submission_id uuid,
  p_decision public.submission_status,
  p_rejection_reason text default null
)
returns public.organization_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission public.organization_submissions;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and nullif(trim(p_rejection_reason), '') is null then
    raise exception 'rejection reason is required' using errcode = '22023';
  end if;

  select * into submission
  from public.organization_submissions
  where id = p_submission_id and status = 'pending'
  for update;
  if not found then
    raise exception 'pending submission not found' using errcode = 'P0002';
  end if;

  update public.organization_submissions
  set status = p_decision,
      rejection_reason = case when p_decision = 'rejected' then left(trim(p_rejection_reason), 1000) else null end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_submission_id
  returning * into submission;

  if p_decision = 'approved' then
    insert into public.organizations (
      id, name, category_id, city, region, address, phone, website, photo, lat, lon, source, source_ref
    ) values (
      'submission:' || submission.id::text,
      submission.organization_name,
      submission.category_id,
      submission.city,
      submission.region,
      submission.address,
      submission.phone,
      submission.website,
      submission.photo,
      submission.lat,
      submission.lon,
      submission.source,
      'submission:' || submission.id::text
    );
  end if;

  insert into public.moderation_events (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_decision::text, 'organization_submission', submission.id::text,
    jsonb_build_object('rejection_reason', submission.rejection_reason));
  return submission;
end;
$$;

revoke all on function public.review_organization_submission(uuid, public.submission_status, text) from public, anon;
grant execute on function public.review_organization_submission(uuid, public.submission_status, text) to authenticated;

-- The existing audit trigger remains installed and keeps its locked search_path.
-- Both categories and organizations are now admin-only mutation surfaces.
create or replace function public.audit_catalog_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entity_id text;
  entity_name text;
  entity_category text;
  action_name text;
  allowed_actor boolean;
begin
  allowed_actor := auth.uid() is not null and (
    (tg_table_name = 'categories' and public.is_admin()) or
    (tg_table_name = 'organizations' and public.is_admin())
  );
  if allowed_actor then
    if tg_op = 'DELETE' then
      entity_id := old.id::text;
      entity_name := old.name;
      if tg_table_name = 'organizations' then entity_category := old.category_id; else entity_category := null; end if;
      action_name := 'deleted';
    elsif tg_op = 'INSERT' then
      entity_id := new.id::text;
      entity_name := new.name;
      if tg_table_name = 'organizations' then entity_category := new.category_id; else entity_category := null; end if;
      action_name := 'created';
    else
      entity_id := new.id::text;
      entity_name := new.name;
      if tg_table_name = 'organizations' then entity_category := new.category_id; else entity_category := null; end if;
      action_name := 'updated';
    end if;

    insert into public.moderation_events (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(), action_name, tg_table_name, entity_id,
      jsonb_build_object('name', entity_name, 'category_id', entity_category)
    );
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.audit_catalog_mutation() from public, anon, authenticated;

-- No policies or privileged routines should depend on the obsolete helper now.
drop function public.is_moderator_or_admin();

commit;
