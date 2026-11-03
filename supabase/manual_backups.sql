-- Execute no SQL Editor do mesmo projeto Supabase já usado pela API.
create table if not exists public.safratab_backups (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null unique,
  bytes integer not null check (bytes > 0 and bytes <= 33554432),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint backup_owner_path check (object_path = user_id::text || '/' || id::text || '.safratab')
);
create index if not exists safratab_backups_owner_date on public.safratab_backups(user_id, created_at desc);
alter table public.safratab_backups enable row level security;
revoke all on public.safratab_backups from anon, authenticated;
grant select, insert, delete on public.safratab_backups to service_role;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('safratab-backups', 'safratab-backups', false, 33554432, array['application/gzip'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- Não criar políticas públicas para este bucket. Somente a API usa service_role.
-- Uma política restritiva impede que políticas amplas de outros buckets exponham estes arquivos.
drop policy if exists safratab_backup_private on storage.objects;
create policy safratab_backup_private on storage.objects as restrictive for all to anon, authenticated
using (bucket_id <> 'safratab-backups') with check (bucket_id <> 'safratab-backups');
