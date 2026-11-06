-- Send organization submissions through the validated Vercel endpoint.
revoke insert on public.organization_submissions from anon, authenticated;
grant select on public.organization_submissions to authenticated;
revoke all on public.organization_submissions from service_role;
grant select, insert on public.organization_submissions to service_role;
drop policy if exists submissions_create_own_pending on public.organization_submissions;

-- Catalog mutations performed with an authenticated admin/moderator token are
-- recorded in the same transaction as the row change.
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
    (tg_table_name = 'organizations' and public.is_moderator_or_admin())
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
create trigger categories_audit_mutation
after insert or update or delete on public.categories
for each row execute function public.audit_catalog_mutation();
create trigger organizations_audit_mutation
after insert or update or delete on public.organizations
for each row execute function public.audit_catalog_mutation();

-- Auth Admin mutations happen outside PostgreSQL's normal table API, so the
-- server records those events with its service-role key after verifying admin.
create or replace function public.record_admin_user_event(
  p_actor_id uuid,
  p_action text,
  p_entity_id text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null or p_action not in ('user_role_changed', 'user_blocked', 'user_unblocked')
    or p_entity_id is null or length(p_entity_id) > 100
    or jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object'
    or length(coalesce(p_details, '{}'::jsonb)::text) > 1000 then
    raise exception 'invalid audit event' using errcode = '22023';
  end if;
  insert into public.moderation_events (actor_id, action, entity_type, entity_id, details)
  values (p_actor_id, p_action, 'user', p_entity_id, coalesce(p_details, '{}'::jsonb));
end;
$$;

revoke all on function public.record_admin_user_event(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_admin_user_event(uuid, text, text, jsonb) to service_role;
