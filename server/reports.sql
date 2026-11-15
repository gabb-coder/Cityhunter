-- Problem reports sent by the City Hunter web app (with the player's consent).
-- Run this once in the Supabase project named in CONFIG.reports, then set
-- CONFIG.reports.enabled to true in js/config.js.
--
-- Phones may only ADD a row. Nobody can read, change or delete rows with the
-- public key; reports are read in the Supabase dashboard (Table editor).

create table public.reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  app_version text not null check (char_length(app_version) <= 20),
  reason text not null check (char_length(reason) <= 60),
  lobby text check (lobby is null or char_length(lobby) <= 12),
  device text not null check (char_length(device) <= 40),
  body text not null check (char_length(body) between 1 and 20000)
);

comment on table public.reports is 'City Hunter problem reports. Insert-only for the public key.';
comment on column public.reports.device is 'Random id made on the phone, only to group reports from one device. Not personal data.';

alter table public.reports enable row level security;

revoke all on public.reports from anon, authenticated;
grant insert on public.reports to anon, authenticated;

create policy "Anyone can add a report"
  on public.reports for insert
  to anon, authenticated
  with check (true);

create index reports_created_at_idx on public.reports (created_at desc);

-- Flood guard: at most 300 reports an hour in total, and rows older than
-- 60 days are cleared as new ones arrive.
create function public.reports_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.reports where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'too many reports, try later';
  end if;
  delete from public.reports where created_at < now() - interval '60 days';
  return new;
end
$$;

revoke all on function public.reports_guard() from public, anon, authenticated;

create trigger reports_guard
  before insert on public.reports
  for each row execute function public.reports_guard();
