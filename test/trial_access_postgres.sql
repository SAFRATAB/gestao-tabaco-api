-- Usar somente em PostgreSQL descartável, como superusuário.
\set ON_ERROR_STOP on
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
\ir ../supabase/trial_access.sql

do $$
declare
  initial jsonb;
  repeated jsonb;
begin
  initial := public.safratab_activate_trial(repeat('a',64), '-----BEGIN PRIVATE KEY-----fixture-one');
  repeated := public.safratab_activate_trial(repeat('a',64), '-----BEGIN PRIVATE KEY-----fixture-two');
  assert initial->>'started_at' = repeated->>'started_at', 'Início renovado';
  assert initial->>'expires_at' = repeated->>'expires_at', 'Término renovado';
  assert repeated->>'signing_private_key' = '-----BEGIN PRIVATE KEY-----fixture-one', 'Chave substituída';
  assert (initial->>'expires_at')::bigint - (initial->>'started_at')::bigint = 1296000000;
  assert public.safratab_get_trial(repeat('b',64)) is null, 'Consulta criou teste';
  assert not has_function_privilege('anon', 'public.safratab_get_trial(text)', 'execute');
  assert not has_function_privilege('authenticated', 'public.safratab_activate_trial(text,text)', 'execute');
  assert not has_table_privilege('anon', 'public.safratab_trial_devices', 'select');
  assert not has_table_privilege('authenticated', 'public.safratab_trial_metadata', 'select');
  assert (select relrowsecurity from pg_class where oid = 'public.safratab_trial_devices'::regclass);
  assert (select relrowsecurity from pg_class where oid = 'public.safratab_trial_metadata'::regclass);
end $$;

-- A credencial de servidor pode executar as RPCs mesmo sem acesso direto às tabelas.
set role service_role;
select public.safratab_get_trial(repeat('a',64)) is not null as servidor_autorizado;
reset role;

-- Reaplicar a instalação não apaga prazo nem chave.
\ir ../supabase/trial_access.sql
do $$ begin
  assert (select count(*) from public.safratab_trial_devices) = 1;
  assert (select value from public.safratab_trial_metadata where name = 'signing_private_key') = '-----BEGIN PRIVATE KEY-----fixture-one';
end $$;
