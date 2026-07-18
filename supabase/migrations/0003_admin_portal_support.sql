-- The admin portal needs to show each user's email (subscription requests,
-- users list), but email lives in auth.users which client-side queries
-- can't join against. Mirror it onto profiles instead, kept in sync at
-- signup time.
alter table profiles add column if not exists email text;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email);
  return new;
end;
$$;

-- Backfill accounts created before this column existed.
update profiles p set email = u.email from auth.users u where p.id = u.id and p.email is null;

-- Admin action: deactivate a user's paid plan back to free (distinct from
-- the user's own cancel_my_subscription — this targets any user by id).
create or replace function admin_deactivate_user_plan(target_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  update profiles
    set plan = 'free', plan_renews_at = null,
        selected_sectors = case
          when array_length(selected_sectors, 1) > 1 then selected_sectors[1:1]
          else selected_sectors
        end
    where id = target_user;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function admin_deactivate_user_plan(uuid) to authenticated;
