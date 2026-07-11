-- Phase 24D-C: authenticated app-user profile and identity bootstrap.
-- Additive function only. It writes no ledger, debt, event, settlement, posting,
-- account, Worker, or Telegram record.

create or replace function public.bootstrap_current_user_identity(
  p_display_name text default null,
  p_avatar_url text default null,
  p_locale text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := public.require_authenticated_user();
  v_auth_metadata jsonb := '{}'::jsonb;
  v_email text;
  v_name text;
  v_avatar_url text;
  v_locale text;
  v_profile public.profiles%rowtype;
  v_profile_inserted_id uuid;
  v_profile_created boolean := false;
  v_identity_id uuid;
  v_identity_kind text;
  v_identity_created boolean := false;
begin
  select coalesce(u.raw_user_meta_data, '{}'::jsonb), u.email
  into v_auth_metadata, v_email
  from auth.users u
  where u.id = v_user_id;

  v_name := left(coalesce(
    nullif(btrim(p_display_name), ''),
    nullif(btrim(v_auth_metadata ->> 'full_name'), ''),
    nullif(btrim(v_auth_metadata ->> 'name'), ''),
    nullif(btrim(split_part(coalesce(v_email, ''), '@', 1)), ''),
    'RinggitMe User'
  ), 120);
  v_avatar_url := coalesce(
    nullif(btrim(p_avatar_url), ''),
    nullif(btrim(v_auth_metadata ->> 'avatar_url'), ''),
    nullif(btrim(v_auth_metadata ->> 'picture'), '')
  );
  v_locale := left(coalesce(nullif(btrim(p_locale), ''), 'zh-MY'), 20);

  -- Creation only: ON CONFLICT deliberately preserves every existing profile
  -- field, including a user-edited display name or avatar.
  insert into public.profiles (id, display_name, avatar_url, locale)
  values (v_user_id, v_name, v_avatar_url, v_locale)
  on conflict (id) do nothing
  returning id into v_profile_inserted_id;

  v_profile_created := v_profile_inserted_id is not null;
  select p.* into strict v_profile
  from public.profiles p
  where p.id = v_user_id;

  select i.id, i.kind into v_identity_id, v_identity_kind
  from public.identities i
  where i.auth_user_id = v_user_id
    and i.merged_into_identity_id is null
    and i.deleted_at is null
  order by i.created_at, i.id
  limit 1;

  if v_identity_id is not null and v_identity_kind <> 'app_user' then
    raise exception using
      errcode = '23514',
      message = 'active authenticated identity has conflicting kind';
  end if;

  if v_identity_id is null then
    insert into public.identities (
      kind, auth_user_id, display_name, created_by, claimed_at
    ) values (
      'app_user', v_user_id, left(v_profile.display_name, 120), v_user_id, now()
    )
    on conflict (auth_user_id)
      where auth_user_id is not null
        and merged_into_identity_id is null
        and deleted_at is null
      do nothing
    returning id into v_identity_id;

    if v_identity_id is not null then
      v_identity_created := true;
    else
      select i.id, i.kind into strict v_identity_id, v_identity_kind
      from public.identities i
      where i.auth_user_id = v_user_id
        and i.merged_into_identity_id is null
        and i.deleted_at is null;

      if v_identity_kind <> 'app_user' then
        raise exception using
          errcode = '23514',
          message = 'active authenticated identity has conflicting kind';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'auth_user_id', v_user_id,
    'profile_id', v_profile.id,
    'identity_id', v_identity_id,
    'display_name', v_profile.display_name,
    'avatar_url', v_profile.avatar_url,
    'locale', v_profile.locale,
    'profile_created', v_profile_created,
    'identity_created', v_identity_created
  );
end;
$$;

revoke all on function public.bootstrap_current_user_identity(text, text, text) from public;
grant execute on function public.bootstrap_current_user_identity(text, text, text) to authenticated;

comment on function public.bootstrap_current_user_identity(text, text, text) is
  'Idempotently creates the current auth user profile and one active app_user identity. Suggestions apply only to a missing profile; existing edits are never overwritten. Writes no shared financial records.';
