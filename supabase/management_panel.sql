-- Aplique depois de manual_backups.sql. Acesso restrito a administradores habilitados.
create table if not exists public.safratab_admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- Somente uma conta administrativa pode permanecer ativa.
create unique index if not exists safratab_one_active_admin on public.safratab_admin_roles ((true)) where active;
create table if not exists public.safratab_management_audit (
  id bigint generated always as identity primary key,
  admin_user_id uuid references auth.users(id) on delete set null,
  producer_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('list','report')),
  created_at timestamptz not null default now()
);
alter table public.safratab_admin_roles enable row level security;
alter table public.safratab_management_audit enable row level security;
revoke all on public.safratab_admin_roles, public.safratab_management_audit from anon, authenticated;
grant select on public.safratab_admin_roles to service_role;
grant insert on public.safratab_management_audit to service_role;
grant usage, select on sequence public.safratab_management_audit_id_seq to service_role;
create or replace function public.safratab_management_producers(p_admin uuid)
returns table(user_id uuid, email text, backup_id uuid, backup_at timestamptz, backup_bytes integer)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.safratab_admin_roles a where a.user_id = p_admin and a.active) then
    raise exception 'Acesso administrativo não autorizado';
  end if;
  return query select u.id, u.email::text, b.id, b.created_at, b.bytes
    from auth.users u
    join lateral (select x.id, x.created_at, x.bytes from public.safratab_backups x where x.user_id = u.id order by x.created_at desc limit 1) b on true
    order by b.created_at desc, u.email;
end;
$$;
revoke all on function public.safratab_management_producers(uuid) from public, anon, authenticated;
grant execute on function public.safratab_management_producers(uuid) to service_role;
-- Para habilitar o administrador, primeiro confirme seu e-mail no painel e depois execute:
-- insert into public.safratab_admin_roles(user_id)
-- select id from auth.users where lower(email) = lower('SEU_EMAIL_ADMINISTRATIVO')
-- on conflict(user_id) do update set active = true;
-- Não execute essa habilitação para contas de produtores.
