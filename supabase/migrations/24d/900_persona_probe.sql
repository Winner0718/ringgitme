-- Phase 24D-B scratch-project persona probe.
-- NEVER include this file in a production migration run.
-- Run only after 001, 002, and 003 in a disposable project, as a database
-- administrator able to SET ROLE. The whole probe rolls back.
--
-- Replace these three clearly fake placeholders with UUIDs belonging to three
-- throwaway Auth users in the scratch project. Do not use real customer users.
\set user_a 'ce6132fb-58ef-458a-977e-f802abf672c8'
\set user_b 'f33e1515-1310-44ac-a53f-39b8a009a86f'
\set user_c 'dc944eb9-3f1c-4838-8a25-969878a8e36c'
\set ON_ERROR_STOP on

begin;

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
select set_config('request.jwt.claim.sub', :'user_a', true);
select public.create_shared_ledger(
  'group', '24D-B Persona Probe',
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
) as ledger_id \gset
select public.invite_member(
  :'ledger_id'::uuid, 'User B', 'code',
  encode(digest('scratch-probe-invite-only', 'sha256'), 'hex'),
  now() + interval '1 hour',
  '10000000-0000-4000-8000-000000000003'::uuid
) as invitation_id \gset
select m.id as member_a_id from public.shared_ledger_members m
where m.ledger_id = :'ledger_id'::uuid and m.identity_id = public.current_identity_id() \gset

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_b', true);
select public.accept_invitation(
  encode(digest('scratch-probe-invite-only', 'sha256'), 'hex')
) as member_b_id \gset

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', true);
select public.create_shared_entry(
  :'ledger_id'::uuid, :'member_a_id'::uuid, 'expense', 'Persona lunch', null, 'Food',
  1000, current_date,
  jsonb_build_array(
    jsonb_build_object(
      'member_id', :'member_a_id', 'amount_sen', 600,
      'client_line_id', '20000000-0000-4000-8000-000000000001'
    ),
    jsonb_build_object(
      'member_id', :'member_b_id', 'amount_sen', 400,
      'client_line_id', '20000000-0000-4000-8000-000000000002'
    )
  ),
  '20000000-0000-4000-8000-000000000003'::uuid,
  '20000000-0000-4000-8000-000000000004'::uuid
) as entry_id \gset
select l.id as line_a_id from public.shared_entry_lines l
where l.entry_id = :'entry_id'::uuid and l.member_id = :'member_a_id'::uuid \gset
select l.id as line_b_id from public.shared_entry_lines l
where l.entry_id = :'entry_id'::uuid and l.member_id = :'member_b_id'::uuid \gset
select set_config('probe.entry_id', :'entry_id', true);
select set_config('probe.line_a_id', :'line_a_id', true);
select set_config('probe.line_b_id', :'line_b_id', true);
select set_config('probe.member_a_id', :'member_a_id', true);
select set_config('probe.member_b_id', :'member_b_id', true);
select set_config('probe.user_a', :'user_a', true);
select set_config('probe.user_b', :'user_b', true);

-- 1. A and B share one ledger.
select pg_temp.assert_true(
  (select count(*) = 2 from public.shared_ledger_members m
   where m.ledger_id = :'ledger_id'::uuid and m.status = 'active'),
  'A and B must be active in one ledger'
);

-- 2. A can read the shared ledger, entry, and both lines.
select pg_temp.assert_true(
  (select count(*) = 1 from public.shared_ledgers l where l.id = :'ledger_id'::uuid)
  and (select count(*) = 1 from public.shared_entries e where e.id = :'entry_id'::uuid)
  and (select count(*) = 2 from public.shared_entry_lines l where l.entry_id = :'entry_id'::uuid),
  'A shared reads'
);

-- 3. B can read the same shared ledger, entry, and both lines.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_b', true);
select pg_temp.assert_true(
  (select count(*) = 1 from public.shared_ledgers l where l.id = :'ledger_id'::uuid)
  and (select count(*) = 1 from public.shared_entries e where e.id = :'entry_id'::uuid)
  and (select count(*) = 2 from public.shared_entry_lines l where l.entry_id = :'entry_id'::uuid),
  'B shared reads'
);

-- 4. C, a non-member, cannot read ledger, entry, line, or event.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_c', true);
select pg_temp.assert_true(
  (select count(*) = 0 from public.shared_ledgers l where l.id = :'ledger_id'::uuid)
  and (select count(*) = 0 from public.shared_entries e where e.id = :'entry_id'::uuid)
  and (select count(*) = 0 from public.shared_entry_lines l where l.entry_id = :'entry_id'::uuid)
  and (select count(*) = 0 from public.shared_entry_events ev where ev.entry_id = :'entry_id'::uuid),
  'C non-member reads must be empty'
);

-- A consumed invitation cannot be replayed by a different authenticated user.
do $$
declare v_rejected boolean := false;
begin
  begin
    perform public.accept_invitation(
      encode(digest('scratch-probe-invite-only', 'sha256'), 'hex')
    );
  exception when check_violation then v_rejected := true;
  end;
  perform pg_temp.assert_true(v_rejected, 'different-user invitation replay must fail');
end;
$$;

-- Setup private postings through each participant's own line.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', true);
insert into public.private_postings (
  owner_user_id, ledger_id, entry_id, line_id, posting_kind, amount_sen,
  account_snapshot, client_posting_id, occurred_at
) values (
  :'user_a'::uuid, :'ledger_id'::uuid, :'entry_id'::uuid, :'line_a_id'::uuid, 'payer_payment', -600,
  '{"account_id":"scratch-a","account_name":"A private cash"}'::jsonb,
  '30000000-0000-4000-8000-000000000001'::uuid, now()
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_b', true);
insert into public.private_postings (
  owner_user_id, ledger_id, entry_id, line_id, posting_kind, amount_sen,
  account_snapshot, client_posting_id, occurred_at
) values (
  :'user_b'::uuid, :'ledger_id'::uuid, :'entry_id'::uuid, :'line_b_id'::uuid, 'debtor_payment', -400,
  '{"account_id":"scratch-b","account_name":"B private wallet"}'::jsonb,
  '30000000-0000-4000-8000-000000000002'::uuid, now()
);

-- 5. A cannot read B private_postings.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', true);
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(owner_user_id = :'user_a'::uuid) from public.private_postings),
  'A must see only A private posting'
);

-- 6. B cannot read A private_postings.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_b', true);
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(owner_user_id = :'user_b'::uuid) from public.private_postings),
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
  :'line_b_id'::uuid, 'accepted', null, 1,
  '40000000-0000-4000-8000-000000000001'::uuid
);
select pg_temp.assert_true(
  (select response_status = 'accepted' from public.shared_entry_lines where id = :'line_b_id'::uuid),
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
  :'line_b_id'::uuid, 'accepted', null, 1,
  '40000000-0000-4000-8000-000000000001'::uuid
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.shared_entry_events ev
   where ev.entry_id = :'entry_id'::uuid
     and ev.client_event_id = '40000000-0000-4000-8000-000000000001'::uuid),
  'duplicate event id must not duplicate events'
);

-- 13. A stale expected revision fails.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', true);
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
select public.create_shared_entry(
  :'ledger_id'::uuid, :'member_b_id'::uuid, 'expense', 'B is named payer', null, 'Security',
  1000, current_date,
  jsonb_build_array(
    jsonb_build_object(
      'member_id', :'member_a_id', 'amount_sen', 400,
      'client_line_id', '50000000-0000-4000-8000-000000000001'
    ),
    jsonb_build_object(
      'member_id', :'member_b_id', 'amount_sen', 600,
      'client_line_id', '50000000-0000-4000-8000-000000000002'
    )
  ),
  '50000000-0000-4000-8000-000000000003'::uuid,
  '50000000-0000-4000-8000-000000000004'::uuid
) as foreign_payer_entry_id \gset
select l.id as foreign_payer_line_id
from public.shared_entry_lines l
where l.entry_id = :'foreign_payer_entry_id'::uuid and l.member_id = :'member_b_id'::uuid \gset
select set_config('probe.foreign_payer_entry_id', :'foreign_payer_entry_id', true);
select set_config('probe.foreign_payer_line_id', :'foreign_payer_line_id', true);
select pg_temp.assert_true(
  (select l.response_status = 'pending'
          and l.settlement_status = 'unpaid'
          and l.accepted_revision is null
          and l.responded_at is null
          and l.confirmed_at is null
   from public.shared_entry_lines l where l.id = :'foreign_payer_line_id'::uuid)
  and (select count(*) = 0 from public.shared_entry_events ev
       where ev.entry_id = :'foreign_payer_entry_id'::uuid
         and ev.actor_member_id = :'member_b_id'::uuid),
  'creator must not forge another payer consent, confirmation, timestamp, or event'
);
select pg_temp.assert_true(
  (select l.response_status = 'auto_accepted' and l.settlement_status = 'confirmed'
   from public.shared_entry_lines l where l.id = :'line_a_id'::uuid),
  'current-user payer behavior must remain auto_accepted and confirmed'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_b', true);
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
  :'foreign_payer_line_id'::uuid, 'accepted', null, 1,
  '50000000-0000-4000-8000-000000000007'::uuid
);
select pg_temp.assert_true(
  (select l.response_status = 'accepted' and l.settlement_status = 'confirmed'
   from public.shared_entry_lines l where l.id = :'foreign_payer_line_id'::uuid)
  and (select count(*) = 1 from public.shared_entry_events ev
       where ev.entry_id = :'foreign_payer_entry_id'::uuid
         and ev.line_id = :'foreign_payer_line_id'::uuid
         and ev.actor_member_id = :'member_b_id'::uuid
         and ev.kind = 'accepted'),
  'actual payer correct-revision acceptance must establish payer consent'
);

-- Security M2/M3 on the original A-payer entry: paid-pending blocks void; B
-- may withdraw paid-pending; confirmed blocks void; B cannot reverse A's
-- confirmation; unrelated C cannot reopen; creditor A can reopen and then void.
select public.mark_line_paid(
  :'line_b_id'::uuid, 1,
  '51000000-0000-4000-8000-000000000001'::uuid
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', true);
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
select set_config('request.jwt.claim.sub', :'user_b', true);
select public.reopen_line(
  :'line_b_id'::uuid, 1,
  '51000000-0000-4000-8000-000000000003'::uuid
);
select pg_temp.assert_true(
  (select settlement_status = 'unpaid' from public.shared_entry_lines where id = :'line_b_id'::uuid),
  'debtor may withdraw paid_pending_confirmation'
);
select public.mark_line_paid(
  :'line_b_id'::uuid, 1,
  '51000000-0000-4000-8000-000000000004'::uuid
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', true);
select public.confirm_line_received(
  :'line_b_id'::uuid, 1,
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
select set_config('request.jwt.claim.sub', :'user_b', true);
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
select set_config('request.jwt.claim.sub', :'user_c', true);
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
select set_config('request.jwt.claim.sub', :'user_a', true);
select public.reopen_line(
  :'line_b_id'::uuid, 1,
  '51000000-0000-4000-8000-000000000009'::uuid
);
select pg_temp.assert_true(
  (select settlement_status = 'reversed' from public.shared_entry_lines where id = :'line_b_id'::uuid),
  'creditor may reopen a confirmed line to reversed'
);
select public.void_entry(
  :'entry_id'::uuid, 1,
  '51000000-0000-4000-8000-000000000010'::uuid
);
select pg_temp.assert_true(
  (select entry_status = 'voided' from public.shared_entries where id = :'entry_id'::uuid),
  'reopened/reversed entry may be voided when no active settlement remains'
);

-- A separate pending/unpaid entry may be voided immediately. The structural
-- creator-payer own line is confirmed by convention and is not an external
-- settlement fact; the counterparty line remains pending/unpaid.
select public.create_shared_entry(
  :'ledger_id'::uuid, :'member_a_id'::uuid, 'expense', 'Pending void probe', null, 'Security',
  500, current_date,
  jsonb_build_array(
    jsonb_build_object('member_id', :'member_a_id', 'amount_sen', 300, 'client_line_id', '52000000-0000-4000-8000-000000000001'),
    jsonb_build_object('member_id', :'member_b_id', 'amount_sen', 200, 'client_line_id', '52000000-0000-4000-8000-000000000002')
  ),
  '52000000-0000-4000-8000-000000000003'::uuid,
  '52000000-0000-4000-8000-000000000004'::uuid
) as pending_void_entry_id \gset
select public.void_entry(
  :'pending_void_entry_id'::uuid, 1,
  '52000000-0000-4000-8000-000000000005'::uuid
);
select pg_temp.assert_true(
  (select entry_status = 'voided' from public.shared_entries where id = :'pending_void_entry_id'::uuid),
  'pending/unpaid entry may be voided'
);

-- Active shared_settlement blocks void even while the linked line is unpaid.
-- Reopening paid-pending reverses that settlement; void then succeeds.
select public.create_shared_entry(
  :'ledger_id'::uuid, :'member_a_id'::uuid, 'expense', 'Settlement void probe', null, 'Security',
  700, current_date,
  jsonb_build_array(
    jsonb_build_object('member_id', :'member_a_id', 'amount_sen', 400, 'client_line_id', '53000000-0000-4000-8000-000000000001'),
    jsonb_build_object('member_id', :'member_b_id', 'amount_sen', 300, 'client_line_id', '53000000-0000-4000-8000-000000000002')
  ),
  '53000000-0000-4000-8000-000000000003'::uuid,
  '53000000-0000-4000-8000-000000000004'::uuid
) as settlement_entry_id \gset
select l.id as settlement_line_id from public.shared_entry_lines l
where l.entry_id = :'settlement_entry_id'::uuid and l.member_id = :'member_b_id'::uuid \gset
select set_config('probe.settlement_entry_id', :'settlement_entry_id', true);
select set_config('probe.settlement_line_id', :'settlement_line_id', true);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_b', true);
select public.respond_to_line(
  :'settlement_line_id'::uuid, 'accepted', null, 1,
  '53000000-0000-4000-8000-000000000005'::uuid
);
select public.record_settlement(
  :'ledger_id'::uuid, :'member_b_id'::uuid, :'member_a_id'::uuid,
  :'settlement_entry_id'::uuid, :'settlement_line_id'::uuid,
  300, now(),
  '53000000-0000-4000-8000-000000000006'::uuid,
  '53000000-0000-4000-8000-000000000007'::uuid
) as active_settlement_id \gset
select set_config('probe.active_settlement_id', :'active_settlement_id', true);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', true);
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
select set_config('request.jwt.claim.sub', :'user_b', true);
select public.mark_line_paid(
  :'settlement_line_id'::uuid, 1,
  '53000000-0000-4000-8000-000000000009'::uuid
);
select public.reopen_line(
  :'settlement_line_id'::uuid, 1,
  '53000000-0000-4000-8000-000000000010'::uuid
);
select pg_temp.assert_true(
  (select status = 'reversed' from public.shared_settlements where id = :'active_settlement_id'::uuid),
  'reopen RPC must reverse linked active settlement'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', true);
select public.void_entry(
  :'settlement_entry_id'::uuid, 1,
  '53000000-0000-4000-8000-000000000011'::uuid
);
select pg_temp.assert_true(
  (select entry_status = 'voided' from public.shared_entries where id = :'settlement_entry_id'::uuid),
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
   from public.invitations i where i.id = :'invitation_id'::uuid),
  'only invitation hash may be stored'
);

-- 15. Removed B loses active shared access, and the shared schemas expose no
-- account snapshot column. account_snapshot exists only on private_postings.
update public.shared_ledger_members
set status = 'removed', removed_at = now()
where id = :'member_b_id'::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_b', true);
select pg_temp.assert_true(
  (select count(*) = 0 from public.shared_ledgers l where l.id = :'ledger_id'::uuid)
  and (select count(*) = 0 from public.shared_entries e where e.id = :'entry_id'::uuid)
  and (select count(*) = 0 from public.shared_entry_lines l where l.entry_id = :'entry_id'::uuid)
  and (select count(*) = 0 from public.shared_entry_events ev where ev.entry_id = :'entry_id'::uuid),
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

rollback;
\echo 'Phase 24D-B persona probe passed; all fixture writes rolled back.'
