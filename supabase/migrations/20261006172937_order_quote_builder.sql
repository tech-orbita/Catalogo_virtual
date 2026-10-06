-- Conserva el pedido original y guarda por separado la versión preparada por
-- el asesor para que pueda retomarse y reenviarse sin reconstruirla desde texto.
alter table public.orders
  add column if not exists quote_items jsonb,
  add column if not exists quote_delivery_fee numeric(12,2) not null default 0;

alter table public.orders
  drop constraint if exists orders_quote_items_array_check;

alter table public.orders
  add constraint orders_quote_items_array_check
  check (quote_items is null or jsonb_typeof(quote_items) = 'array');

alter table public.orders
  drop constraint if exists orders_quote_delivery_fee_check;

alter table public.orders
  add constraint orders_quote_delivery_fee_check
  check (quote_delivery_fee >= 0);
