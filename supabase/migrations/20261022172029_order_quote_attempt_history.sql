create table if not exists public.order_quote_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  revision integer not null check (revision > 0),
  attempt_kind text not null check (attempt_kind in ('initial', 'resend')),
  status text not null check (status in ('requested', 'error')),
  quote_message text not null,
  quote_items jsonb not null check (jsonb_typeof(quote_items) = 'array'),
  delivery_fee numeric(12, 2) not null default 0 check (delivery_fee >= 0),
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  requested_by_email text,
  requested_at timestamptz not null default now(),
  error_message text,
  accepted_notified_at timestamptz,
  unique (order_id, revision)
);

create index if not exists order_quote_attempts_order_requested_idx
  on public.order_quote_attempts (order_id, requested_at desc);

alter table public.order_quote_attempts enable row level security;

create policy "dashboard users can read quote attempts"
  on public.order_quote_attempts
  for select
  to authenticated
  using ((select public.dashboard_role()) in ('admin', 'operator'));

create policy "dashboard users can create quote attempts"
  on public.order_quote_attempts
  for insert
  to authenticated
  with check ((select public.dashboard_role()) in ('admin', 'operator'));

create policy "admins can update quote attempts"
  on public.order_quote_attempts
  for update
  to authenticated
  using ((select public.dashboard_role()) = 'admin')
  with check ((select public.dashboard_role()) = 'admin');
