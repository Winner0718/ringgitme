-- Phase 24D-B Supabase Dashboard SQL Editor persona probe.
-- 900_persona_probe.sql is the canonical psql version.
-- 901_persona_probe_dashboard.sql is this pure PostgreSQL Dashboard version.
-- SCRATCH/DISPOSABLE PROJECT ONLY. NEVER RUN IN PRODUCTION.
-- Run as Role postgres only after 001, 002, and 003. The transaction rolls
-- back every fixture on success; any assertion error aborts fixture writes.

begin;

-- Scratch Auth UUID configuration. Keep all three disposable user IDs here.
create temporary table persona_probe_config (
  persona text primary key,
  user_id uuid not null unique
) on commit drop;

insert into persona_probe_config (persona, user_id) values
  ('user_a', 'ce6132fb-58ef-458a-977e-f802abf672c8'::uuid),
  ('user_b', 'f33e1515-1310-44ac-a53f-39b8a009a86f'::uuid),
  ('user_c', 'dc944eb9-3f1c-4838-8a25-969878a8e36c'::uuid);

create temporary table persona_probe_state (
  state_key text primary key,
  state_value uuid not null
) on commit drop;

grant select on table persona_probe_config to authenticated;
grant select, insert, update on table persona_probe_state to authenticated;

create function pg_temp.probe_user(p_persona text)
returns uuid
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select c.user_id
  from persona_probe_config c
  where c.persona = p_persona
$$;

create function pg_temp.probe_id(p_state_key text)
returns uuid
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select s.state_value
  from persona_probe_state s
  where s.state_key = p_state_key
$$;

create function pg_temp.probe_put(p_state_key text, p_state_value uuid)
returns uuid
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_state_value is null then
    raise exception 'PERSONA PROBE FAILED: state value % is NULL', p_state_key;
  end if;
  insert into persona_probe_state (state_key, state_value)
  values (p_state_key, p_state_value)
  on conflict (state_key) do update set state_value = excluded.state_value;
  return p_state_value;
end;
$$;

create function pg_temp.assert_true(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'PERSONA PROBE FAILED: %', p_message;
  end if;
end;
$$;

-- Persona preflight: anon has no direct table privilege.
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.shared_ledgers', 'select'),
  'anon must not have shared_ledgers SELECT'
);

-- Privacy guard: every current RinggitMe payment-account key variant is
-- rejected after normalization, including nested object/array placement.
select pg_temp.assert_true(
  (
    select bool_and(not public.shared_json_is_account_free(jsonb_build_object(v.key_name, 'private-value')))
    from (values
      ('paymentAccountName'), ('paymentAccountId'),
      ('receivingAccountName'), ('receivingAccountId'),
      ('accountName'), ('accountId'), ('payName'), ('payId'), ('payAccount'),
      ('receiveCardId'), ('receiveCardName'), ('walletName'), ('bankName'),
      ('cardName'), ('iban')
    ) as v(key_name)
  ),
  'all current RinggitMe account key variants must be rejected'
);
select pg_temp.assert_true(
  not public.shared_json_is_account_free(
    jsonb_build_object(
      'receipt', jsonb_build_array(
        jsonb_build_object('details', jsonb_build_object('payment_account_name', 'private-value'))
      )
    )
  ),
  'nested object/array account keys must be rejected'
);
select pg_temp.assert_true(
  public.shared_json_is_account_free(
    '{"amount_sen":100,"member":"A","title":"Lunch","category":"Food","receipt":"photo","settlement_status":"unpaid"}'::jsonb
  ),
  'normal canonical shared fields must remain allowed'
);

-- Setup: A creates a shared ledger and an invitation; B consumes the hash.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_a')::text, true);
select pg_temp.probe_put(
  'ledger_id',
  public.create_shared_ledger(
    'group', '24D-B Persona Probe',
    '10000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000002'::uuid
  )
);
select pg_temp.probe_put(
  'invitation_id',
  public.invite_member(
    pg_temp.probe_id('ledger_id'), 'User B', 'code',
    encode(extensions.digest(convert_to('scratch-probe-invite-only', 'UTF8'), 'sha256'), 'hex'),
    now() + interval '1 hour',
    '10000000-0000-4000-8000-000000000003'::uuid
  )
);
select pg_temp.probe_put(
  'member_a_id',
  (
    select m.id
    from public.shared_ledger_members m
    where m.ledger_id = pg_temp.probe_id('ledger_id')
      and m.identity_id = public.current_identity_id()
  )
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_b')::text, true);
select pg_temp.probe_put(
  'member_b_id',
  public.accept_invitation(
    encode(extensions.digest(convert_to('scratch-probe-invite-only', 'UTF8'), 'sha256'), 'hex')
  )
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_a')::text, true);
select pg_temp.probe_put(
  'entry_id',
  public.create_shared_entry(
    pg_temp.probe_id('ledger_id'), pg_temp.probe_id('member_a_id'),
    'expense', 'Persona lunch', null, 'Food', 1000, current_date,
    jsonb_build_array(
      jsonb_build_object(
        'member_id', pg_temp.probe_id('member_a_id'), 'amount_sen', 600,
        'client_line_id', '20000000-0000-4000-8000-000000000001'
      ),
      jsonb_build_object(
        'member_id', pg_temp.probe_id('member_b_id'), 'amount_sen', 400,
        'client_line_id', '20000000-0000-4000-8000-000000000002'
      )
    ),
    '20000000-0000-4000-8000-000000000003'::uuid,
    '20000000-0000-4000-8000-000000000004'::uuid
  )
);
select pg_temp.probe_put(
  'line_a_id',
  (
    select l.id from public.shared_entry_lines l
    where l.entry_id = pg_temp.probe_id('entry_id')
      and l.member_id = pg_temp.probe_id('member_a_id')
  )
);
select pg_temp.probe_put(
  'line_b_id',
  (
    select l.id from public.shared_entry_lines l
    where l.entry_id = pg_temp.probe_id('entry_id')
      and l.member_id = pg_temp.probe_id('member_b_id')
  )
);
select set_config('probe.entry_id', pg_temp.probe_id('entry_id')::text, true);
select set_config('probe.line_a_id', pg_temp.probe_id('line_a_id')::text, true);
select set_config('probe.line_b_id', pg_temp.probe_id('line_b_id')::text, true);
select set_config('probe.member_a_id', pg_temp.probe_id('member_a_id')::text, true);
select set_config('probe.member_b_id', pg_temp.probe_id('member_b_id')::text, true);
select set_config('probe.user_a', pg_temp.probe_user('user_a')::text, true);
select set_config('probe.user_b', pg_temp.probe_user('user_b')::text, true);

-- 1. A and B share one ledger.
select pg_temp.assert_true(
  (select count(*) = 2 from public.shared_ledger_members m
   where m.ledger_id = pg_temp.probe_id('ledger_id') and m.status = 'active'),
  'A and B must be active in one ledger'
);

-- 2. A can read the shared ledger, entry, and both lines.
select pg_temp.assert_true(
  (select count(*) = 1 from public.shared_ledgers l where l.id = pg_temp.probe_id('ledger_id'))
  and (select count(*) = 1 from public.shared_entries e where e.id = pg_temp.probe_id('entry_id'))
  and (select count(*) = 2 from public.shared_entry_lines l where l.entry_id = pg_temp.probe_id('entry_id')),
  'A shared reads'
);

-- 3. B can read the same shared ledger, entry, and both lines.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_b')::text, true);
select pg_temp.assert_true(
  (select count(*) = 1 from public.shared_ledgers l where l.id = pg_temp.probe_id('ledger_id'))
  and (select count(*) = 1 from public.shared_entries e where e.id = pg_temp.probe_id('entry_id'))
  and (select count(*) = 2 from public.shared_entry_lines l where l.entry_id = pg_temp.probe_id('entry_id')),
  'B shared reads'
);

-- 4. C, a non-member, cannot read ledger, entry, line, or event.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_c')::text, true);
select pg_temp.assert_true(
  (select count(*) = 0 from public.shared_ledgers l where l.id = pg_temp.probe_id('ledger_id'))
  and (select count(*) = 0 from public.shared_entries e where e.id = pg_temp.probe_id('entry_id'))
  and (select count(*) = 0 from public.shared_entry_lines l where l.entry_id = pg_temp.probe_id('entry_id'))
  and (select count(*) = 0 from public.shared_entry_events ev where ev.entry_id = pg_temp.probe_id('entry_id')),
  'C non-member reads must be empty'
);

-- A consumed invitation cannot be replayed by a different authenticated user.
do $$
declare v_rejected boolean := false;
begin
  begin
    perform public.accept_invitation(
      encode(extensions.digest(convert_to('scratch-probe-invite-only', 'UTF8'), 'sha256'), 'hex')
    );
  exception when check_violation then v_rejected := true;
  end;
  perform pg_temp.assert_true(v_rejected, 'different-user invitation replay must fail');
end;
$$;

-- Setup private postings through each participant's own line.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_a')::text, true);
insert into public.private_postings (
  owner_user_id, ledger_id, entry_id, line_id, posting_kind, amount_sen,
  account_snapshot, client_posting_id, occurred_at
) values (
  pg_temp.probe_user('user_a'), pg_temp.probe_id('ledger_id'), pg_temp.probe_id('entry_id'), pg_temp.probe_id('line_a_id'), 'payer_payment', -600,
  '{"account_id":"scratch-a","account_name":"A private cash"}'::jsonb,
  '30000000-0000-4000-8000-000000000001'::uuid, now()
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_b')::text, true);
insert into public.private_postings (
  owner_user_id, ledger_id, entry_id, line_id, posting_kind, amount_sen,
  account_snapshot, client_posting_id, occurred_at
) values (
  pg_temp.probe_user('user_b'), pg_temp.probe_id('ledger_id'), pg_temp.probe_id('entry_id'), pg_temp.probe_id('line_b_id'), 'debtor_payment', -400,
  '{"account_id":"scratch-b","account_name":"B private wallet"}'::jsonb,
  '30000000-0000-4000-8000-000000000002'::uuid, now()
);

-- 5. A cannot read B private_postings.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_a')::text, true);
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(owner_user_id = pg_temp.probe_user('user_a')) from public.private_postings),
  'A must see only A private posting'
);

-- 6. B cannot read A private_postings.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_b')::text, true);
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(owner_user_id = pg_temp.probe_user('user_b')) from public.private_postings),
  'B must see only B private posting'
);

-- Private-posting WITH CHECK rejects a forged owner_user_id even when the
-- caller legitimately participates in the referenced line.
do $$
declare v_denied boolean := false;
begin
  begin
    insert into public.private_postings (
      owner_user_id, entry_id, line_id, posting_kind, amount_sen,
      account_snapshot, client_posting_id, occurred_at
    ) values (
      current_setting('probe.user_a')::uuid,
      current_setting('probe.entry_id')::uuid,
      current_setting('probe.line_b_id')::uuid,
      'debtor_payment', -400, '{"account_id":"forged-owner"}'::jsonb,
      '30000000-0000-4000-8000-000000000003'::uuid, now()
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  perform pg_temp.assert_true(v_denied, 'forged private-posting owner must fail RLS WITH CHECK');
end;
$$;

-- Private-posting reference authorization rejects a line for which B is
-- neither the line member nor payer, while owner_user_id itself is genuine.
do $$
declare v_denied boolean := false;
begin
  begin
    insert into public.private_postings (
      owner_user_id, entry_id, line_id, posting_kind, amount_sen,
      account_snapshot, client_posting_id, occurred_at
    ) values (
      current_setting('probe.user_b')::uuid,
      current_setting('probe.entry_id')::uuid,
      current_setting('probe.line_a_id')::uuid,
      'debtor_payment', -600, '{"account_id":"wrong-line"}'::jsonb,
      '30000000-0000-4000-8000-000000000004'::uuid, now()
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  perform pg_temp.assert_true(v_denied, 'private posting for unrelated line must fail RLS WITH CHECK');
end;
$$;

-- 7. Missing table grants deny direct UPDATE shared_entries. This proves the
-- grant-level RPC-only boundary; it is not an RLS-row-filter assertion.
do $$
declare v_denied boolean := false;
begin
  begin
    update public.shared_entries set title = 'forbidden'
    where id = current_setting('probe.entry_id')::uuid;
  exception when insufficient_privilege then v_denied := true;
  end;
  perform pg_temp.assert_true(v_denied, 'table grants must deny direct shared_entries UPDATE');
end;
$$;

-- 8. Missing table grants deny direct UPDATE of another member line.
do $$
declare v_denied boolean := false;
begin
  begin
    update public.shared_entry_lines set amount_sen = 1
    where id = current_setting('probe.line_a_id')::uuid;
  exception when insufficient_privilege then v_denied := true;
  end;
  perform pg_temp.assert_true(v_denied, 'table grants must deny direct other-member line UPDATE');
end;
$$;

-- 9. Missing table grants deny direct DELETE of an append-only event.
do $$
declare v_denied boolean := false;
begin
  begin
    delete from public.shared_entry_events
    where entry_id = current_setting('probe.entry_id')::uuid;
  exception when insufficient_privilege then v_denied := true;
  end;
  perform pg_temp.assert_true(v_denied, 'table grants must deny event DELETE');
end;
$$;

-- 10. respond_to_line works for B's own line.
select public.respond_to_line(
  pg_temp.probe_id('line_b_id'), 'accepted', null, 1,
  '40000000-0000-4000-8000-000000000001'::uuid
);
select pg_temp.assert_true(
  (select response_status = 'accepted' from public.shared_entry_lines where id = pg_temp.probe_id('line_b_id')),
  'B own-line response'
);

-- 11. respond_to_line fails for another member's line.
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.respond_to_line(
      current_setting('probe.line_a_id')::uuid, 'accepted', null, 1,
      '40000000-0000-4000-8000-000000000002'::uuid
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  perform pg_temp.assert_true(v_denied, 'B cannot respond for A');
end;
$$;

-- 12. Reusing the same client_event_id is idempotent and creates no duplicate.
select public.respond_to_line(
  pg_temp.probe_id('line_b_id'), 'accepted', null, 1,
  '40000000-0000-4000-8000-000000000001'::uuid
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.shared_entry_events ev
   where ev.entry_id = pg_temp.probe_id('entry_id')
     and ev.client_event_id = '40000000-0000-4000-8000-000000000001'::uuid),
  'duplicate event id must not duplicate events'
);

-- 13. A stale expected revision fails.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_a')::text, true);
do $$
declare v_stale boolean := false;
begin
  begin
    perform public.revise_entry(
      current_setting('probe.entry_id')::uuid, 'stale write', null, null, 1000,
      jsonb_build_array(
        jsonb_build_object('member_id', current_setting('probe.member_a_id'), 'amount_sen', 600, 'client_line_id', '20000000-0000-4000-8000-000000000001'),
        jsonb_build_object('member_id', current_setting('probe.member_b_id'), 'amount_sen', 400, 'client_line_id', '20000000-0000-4000-8000-000000000002')
      ),
      0, '40000000-0000-4000-8000-000000000003'::uuid
    );
  exception when serialization_failure then v_stale := true;
  end;
  perform pg_temp.assert_true(v_stale, 'stale expected revision must fail');
end;
$$;

-- Security H2/M1: A names B as payer. Creation must not claim B accepted or
-- confirmed; NULL/stale revisions fail, and B's correct-revision acceptance is
-- the first immutable event attributable to B for this entry.
select pg_temp.probe_put(
  'foreign_payer_entry_id',
  public.create_shared_entry(
    pg_temp.probe_id('ledger_id'), pg_temp.probe_id('member_b_id'),
    'expense', 'B is named payer', null, 'Security', 1000, current_date,
    jsonb_build_array(
      jsonb_build_object(
        'member_id', pg_temp.probe_id('member_a_id'), 'amount_sen', 400,
        'client_line_id', '50000000-0000-4000-8000-000000000001'
      ),
      jsonb_build_object(
        'member_id', pg_temp.probe_id('member_b_id'), 'amount_sen', 600,
        'client_line_id', '50000000-0000-4000-8000-000000000002'
      )
    ),
    '50000000-0000-4000-8000-000000000003'::uuid,
    '50000000-0000-4000-8000-000000000004'::uuid
  )
);
select pg_temp.probe_put(
  'foreign_payer_line_id',
  (
    select l.id
    from public.shared_entry_lines l
    where l.entry_id = pg_temp.probe_id('foreign_payer_entry_id')
      and l.member_id = pg_temp.probe_id('member_b_id')
  )
);
select set_config('probe.foreign_payer_entry_id', pg_temp.probe_id('foreign_payer_entry_id')::text, true);
select set_config('probe.foreign_payer_line_id', pg_temp.probe_id('foreign_payer_line_id')::text, true);
select pg_temp.assert_true(
  (select l.response_status = 'pending'
          and l.settlement_status = 'unpaid'
          and l.accepted_revision is null
          and l.responded_at is null
          and l.confirmed_at is null
   from public.shared_entry_lines l where l.id = pg_temp.probe_id('foreign_payer_line_id'))
  and (select count(*) = 0 from public.shared_entry_events ev
       where ev.entry_id = pg_temp.probe_id('foreign_payer_entry_id')
         and ev.actor_member_id = pg_temp.probe_id('member_b_id')),
  'creator must not forge another payer consent, confirmation, timestamp, or event'
);
select pg_temp.assert_true(
  (select l.response_status = 'auto_accepted' and l.settlement_status = 'confirmed'
   from public.shared_entry_lines l where l.id = pg_temp.probe_id('line_a_id')),
  'current-user payer behavior must remain auto_accepted and confirmed'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_b')::text, true);
do $$
declare v_null_rejected boolean := false;
begin
  begin
    perform public.respond_to_line(
      current_setting('probe.foreign_payer_line_id')::uuid,
      'accepted', null, null,
      '50000000-0000-4000-8000-000000000005'::uuid
    );
  exception when invalid_parameter_value then v_null_rejected := true;
  end;
  perform pg_temp.assert_true(v_null_rejected, 'NULL expected revision must fail');
end;
$$;
do $$
declare v_stale_rejected boolean := false;
begin
  begin
    perform public.respond_to_line(
      current_setting('probe.foreign_payer_line_id')::uuid,
      'accepted', null, 0,
      '50000000-0000-4000-8000-000000000006'::uuid
    );
  exception when serialization_failure then v_stale_rejected := true;
  end;
  perform pg_temp.assert_true(v_stale_rejected, 'stale expected revision must fail');
end;
$$;
select public.respond_to_line(
  pg_temp.probe_id('foreign_payer_line_id'), 'accepted', null, 1,
  '50000000-0000-4000-8000-000000000007'::uuid
);
select pg_temp.assert_true(
  (select l.response_status = 'accepted' and l.settlement_status = 'confirmed'
   from public.shared_entry_lines l where l.id = pg_temp.probe_id('foreign_payer_line_id'))
  and (select count(*) = 1 from public.shared_entry_events ev
       where ev.entry_id = pg_temp.probe_id('foreign_payer_entry_id')
         and ev.line_id = pg_temp.probe_id('foreign_payer_line_id')
         and ev.actor_member_id = pg_temp.probe_id('member_b_id')
         and ev.kind = 'accepted'),
  'actual payer correct-revision acceptance must establish payer consent'
);

-- Security M2/M3 on the original A-payer entry: paid-pending blocks void; B
-- may withdraw paid-pending; confirmed blocks void; B cannot reverse A's
-- confirmation; unrelated C cannot reopen; creditor A can reopen and then void.
select public.mark_line_paid(
  pg_temp.probe_id('line_b_id'), 1,
  '51000000-0000-4000-8000-000000000001'::uuid
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_a')::text, true);
do $$
declare v_blocked boolean := false;
begin
  begin
    perform public.void_entry(
      current_setting('probe.entry_id')::uuid, 1,
      '51000000-0000-4000-8000-000000000002'::uuid
    );
  exception when check_violation then v_blocked := true;
  end;
  perform pg_temp.assert_true(v_blocked, 'paid_pending_confirmation must block void');
end;
$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_b')::text, true);
select public.reopen_line(
  pg_temp.probe_id('line_b_id'), 1,
  '51000000-0000-4000-8000-000000000003'::uuid
);
select pg_temp.assert_true(
  (select settlement_status = 'unpaid' from public.shared_entry_lines where id = pg_temp.probe_id('line_b_id')),
  'debtor may withdraw paid_pending_confirmation'
);
select public.mark_line_paid(
  pg_temp.probe_id('line_b_id'), 1,
  '51000000-0000-4000-8000-000000000004'::uuid
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_a')::text, true);
select public.confirm_line_received(
  pg_temp.probe_id('line_b_id'), 1,
  '51000000-0000-4000-8000-000000000005'::uuid
);
do $$
declare v_blocked boolean := false;
begin
  begin
    perform public.void_entry(
      current_setting('probe.entry_id')::uuid, 1,
      '51000000-0000-4000-8000-000000000006'::uuid
    );
  exception when check_violation then v_blocked := true;
  end;
  perform pg_temp.assert_true(v_blocked, 'confirmed entry must block void');
end;
$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_b')::text, true);
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.reopen_line(
      current_setting('probe.line_b_id')::uuid, 1,
      '51000000-0000-4000-8000-000000000007'::uuid
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  perform pg_temp.assert_true(v_denied, 'debtor cannot reopen a confirmed line');
end;
$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_c')::text, true);
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.reopen_line(
      current_setting('probe.line_b_id')::uuid, 1,
      '51000000-0000-4000-8000-000000000008'::uuid
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  perform pg_temp.assert_true(v_denied, 'unrelated member cannot reopen any line');
end;
$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_a')::text, true);
select public.reopen_line(
  pg_temp.probe_id('line_b_id'), 1,
  '51000000-0000-4000-8000-000000000009'::uuid
);
select pg_temp.assert_true(
  (select settlement_status = 'reversed' from public.shared_entry_lines where id = pg_temp.probe_id('line_b_id')),
  'creditor may reopen a confirmed line to reversed'
);
select public.void_entry(
  pg_temp.probe_id('entry_id'), 1,
  '51000000-0000-4000-8000-000000000010'::uuid
);
select pg_temp.assert_true(
  (select entry_status = 'voided' from public.shared_entries where id = pg_temp.probe_id('entry_id')),
  'reopened/reversed entry may be voided when no active settlement remains'
);

-- A separate pending/unpaid entry may be voided immediately. The structural
-- creator-payer own line is confirmed by convention and is not an external
-- settlement fact; the counterparty line remains pending/unpaid.
select pg_temp.probe_put(
  'pending_void_entry_id',
  public.create_shared_entry(
    pg_temp.probe_id('ledger_id'), pg_temp.probe_id('member_a_id'),
    'expense', 'Pending void probe', null, 'Security', 500, current_date,
    jsonb_build_array(
      jsonb_build_object('member_id', pg_temp.probe_id('member_a_id'), 'amount_sen', 300, 'client_line_id', '52000000-0000-4000-8000-000000000001'),
      jsonb_build_object('member_id', pg_temp.probe_id('member_b_id'), 'amount_sen', 200, 'client_line_id', '52000000-0000-4000-8000-000000000002')
    ),
    '52000000-0000-4000-8000-000000000003'::uuid,
    '52000000-0000-4000-8000-000000000004'::uuid
  )
);
select public.void_entry(
  pg_temp.probe_id('pending_void_entry_id'), 1,
  '52000000-0000-4000-8000-000000000005'::uuid
);
select pg_temp.assert_true(
  (select entry_status = 'voided' from public.shared_entries where id = pg_temp.probe_id('pending_void_entry_id')),
  'pending/unpaid entry may be voided'
);

-- Active shared_settlement blocks void even while the linked line is unpaid.
-- Reopening paid-pending reverses that settlement; void then succeeds.
select pg_temp.probe_put(
  'settlement_entry_id',
  public.create_shared_entry(
    pg_temp.probe_id('ledger_id'), pg_temp.probe_id('member_a_id'),
    'expense', 'Settlement void probe', null, 'Security', 700, current_date,
    jsonb_build_array(
      jsonb_build_object('member_id', pg_temp.probe_id('member_a_id'), 'amount_sen', 400, 'client_line_id', '53000000-0000-4000-8000-000000000001'),
      jsonb_build_object('member_id', pg_temp.probe_id('member_b_id'), 'amount_sen', 300, 'client_line_id', '53000000-0000-4000-8000-000000000002')
    ),
    '53000000-0000-4000-8000-000000000003'::uuid,
    '53000000-0000-4000-8000-000000000004'::uuid
  )
);
select pg_temp.probe_put(
  'settlement_line_id',
  (
    select l.id from public.shared_entry_lines l
    where l.entry_id = pg_temp.probe_id('settlement_entry_id')
      and l.member_id = pg_temp.probe_id('member_b_id')
  )
);
select set_config('probe.settlement_entry_id', pg_temp.probe_id('settlement_entry_id')::text, true);
select set_config('probe.settlement_line_id', pg_temp.probe_id('settlement_line_id')::text, true);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_b')::text, true);
select public.respond_to_line(
  pg_temp.probe_id('settlement_line_id'), 'accepted', null, 1,
  '53000000-0000-4000-8000-000000000005'::uuid
);
select pg_temp.probe_put(
  'active_settlement_id',
  public.record_settlement(
    pg_temp.probe_id('ledger_id'), pg_temp.probe_id('member_b_id'), pg_temp.probe_id('member_a_id'),
    pg_temp.probe_id('settlement_entry_id'), pg_temp.probe_id('settlement_line_id'),
    300, now(),
    '53000000-0000-4000-8000-000000000006'::uuid,
    '53000000-0000-4000-8000-000000000007'::uuid
  )
);
select set_config('probe.active_settlement_id', pg_temp.probe_id('active_settlement_id')::text, true);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_a')::text, true);
do $$
declare v_blocked boolean := false;
begin
  begin
    perform public.void_entry(
      current_setting('probe.settlement_entry_id')::uuid, 1,
      '53000000-0000-4000-8000-000000000008'::uuid
    );
  exception when check_violation then v_blocked := true;
  end;
  perform pg_temp.assert_true(v_blocked, 'active shared settlement must block void');
end;
$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_b')::text, true);
select public.mark_line_paid(
  pg_temp.probe_id('settlement_line_id'), 1,
  '53000000-0000-4000-8000-000000000009'::uuid
);
select public.reopen_line(
  pg_temp.probe_id('settlement_line_id'), 1,
  '53000000-0000-4000-8000-000000000010'::uuid
);
select pg_temp.assert_true(
  (select status = 'reversed' from public.shared_settlements where id = pg_temp.probe_id('active_settlement_id')),
  'reopen RPC must reverse linked active settlement'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_a')::text, true);
select public.void_entry(
  pg_temp.probe_id('settlement_entry_id'), 1,
  '53000000-0000-4000-8000-000000000011'::uuid
);
select pg_temp.assert_true(
  (select entry_status = 'voided' from public.shared_entries where id = pg_temp.probe_id('settlement_entry_id')),
  'entry may be voided after linked settlement reversal'
);

-- 14. Invitation stores a SHA-256 digest, not the raw invite token; normal
-- authenticated clients have no SELECT privilege on code_hash.
select pg_temp.assert_true(
  not has_column_privilege('authenticated', 'public.invitations', 'code_hash', 'select'),
  'authenticated role must not select invitation code_hash'
);
reset role;
select pg_temp.assert_true(
  (select i.code_hash ~ '^[0-9a-f]{64}$' and i.code_hash <> 'scratch-probe-invite-only'
   from public.invitations i where i.id = pg_temp.probe_id('invitation_id')),
  'only invitation hash may be stored'
);

-- 15. Removed B loses active shared access, and the shared schemas expose no
-- account snapshot column. account_snapshot exists only on private_postings.
update public.shared_ledger_members
set status = 'removed', removed_at = now()
where id = pg_temp.probe_id('member_b_id');
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.probe_user('user_b')::text, true);
select pg_temp.assert_true(
  (select count(*) = 0 from public.shared_ledgers l where l.id = pg_temp.probe_id('ledger_id'))
  and (select count(*) = 0 from public.shared_entries e where e.id = pg_temp.probe_id('entry_id'))
  and (select count(*) = 0 from public.shared_entry_lines l where l.entry_id = pg_temp.probe_id('entry_id'))
  and (select count(*) = 0 from public.shared_entry_events ev where ev.entry_id = pg_temp.probe_id('entry_id')),
  'removed member must lose active access'
);
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.mark_line_paid(
      current_setting('probe.foreign_payer_line_id')::uuid, 1,
      '54000000-0000-4000-8000-000000000001'::uuid
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  perform pg_temp.assert_true(v_denied, 'removed member mutation RPC must fail authorization');
end;
$$;
reset role;
select pg_temp.assert_true(
  (select count(*) = 1
   from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name in (
       'profiles', 'identities', 'telegram_identities', 'shared_ledgers',
       'shared_ledger_members', 'invitations', 'shared_entries',
       'shared_entry_lines', 'shared_entry_events', 'shared_settlements',
       'private_postings', 'shared_media', 'shared_media_links'
     )
     and c.column_name = 'account_snapshot'
     and c.table_name = 'private_postings'),
  'account_snapshot must exist only in private_postings'
);

do $$
begin
  raise notice 'Phase 24D-B Dashboard persona probe passed; all fixture writes rolled back.';
end;
$$;

rollback;
