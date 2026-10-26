-- Executar uma vez no SQL Editor de um projeto Supabase Free.
-- Pode ser executado novamente sem apagar ou renovar testes existentes.
begin;

create table if not exists public.safratab_trial_devices (
  device_hash text primary key check (device_hash ~ '^[a-f0-9]{64}$'),
  started_at bigint not null,
  expires_at bigint not null,
  check (expires_at = started_at + 1296000000)
);
create table if not exists public.safratab_trial_metadata (
  name text primary key,
  value text not null
);

alter table public.safratab_trial_devices enable row level security;
alter table public.safratab_trial_metadata enable row level security;
revoke all on public.safratab_trial_devices, public.safratab_trial_metadata from public, anon, authenticated;

create or replace function public.safratab_get_trial(p_device_hash text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'device_hash', d.device_hash, 'started_at', d.started_at, 'expires_at', d.expires_at,
    'server_now', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
    'signing_private_key', m.value)
  from public.safratab_trial_devices d
  cross join public.safratab_trial_metadata m
  where d.device_hash = p_device_hash and m.name = 'signing_private_key';
$$;

create or replace function public.safratab_activate_trial(p_device_hash text, p_signing_private_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  started bigint;
begin
  if p_device_hash is null or p_device_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Identificador inválido';
  end if;
  if p_signing_private_key is null or length(p_signing_private_key) > 4096 or
      p_signing_private_key not like '-----BEGIN PRIVATE KEY-----%' then
    raise exception 'Chave inválida';
  end if;
  insert into public.safratab_trial_metadata(name, value)
    values ('signing_private_key', p_signing_private_key) on conflict (name) do nothing;
  started := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  insert into public.safratab_trial_devices(device_hash, started_at, expires_at)
    values (p_device_hash, started, started + 1296000000) on conflict (device_hash) do nothing;
  return public.safratab_get_trial(p_device_hash);
end;
$$;

revoke all on function public.safratab_get_trial(text) from public, anon, authenticated;
revoke all on function public.safratab_activate_trial(text, text) from public, anon, authenticated;
grant execute on function public.safratab_get_trial(text) to service_role;
grant execute on function public.safratab_activate_trial(text, text) to service_role;
commit;
