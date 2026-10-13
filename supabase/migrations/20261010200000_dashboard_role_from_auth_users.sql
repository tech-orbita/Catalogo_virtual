-- Admins y operadores siempre deben ver todo el historial de pedidos.
-- Antes el rol se leía solo del JWT: si el rol se asignaba después de iniciar
-- sesión, el token no lo traía y RLS devolvía 0 pedidos sin error.
-- Ahora el rol se lee de auth.users (fuente de verdad) y el JWT queda de respaldo.

create or replace function public.dashboard_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.raw_app_meta_data ->> 'role' from auth.users u where u.id = auth.uid()),
    auth.jwt() -> 'app_metadata' ->> 'role'
  );
$$;

revoke all on function public.dashboard_role() from public;
grant execute on function public.dashboard_role() to authenticated;

drop policy if exists "admin select orders" on public.orders;
drop policy if exists "dashboard select orders" on public.orders;
create policy "dashboard select orders" on public.orders for select to authenticated
  using ((select public.dashboard_role()) in ('admin', 'operator'));

drop policy if exists "admin update orders" on public.orders;
drop policy if exists "dashboard update orders" on public.orders;
create policy "dashboard update orders" on public.orders for update to authenticated
  using ((select public.dashboard_role()) in ('admin', 'operator'))
  with check ((select public.dashboard_role()) in ('admin', 'operator'));

drop policy if exists "admin select order_items" on public.order_items;
drop policy if exists "dashboard select order_items" on public.order_items;
create policy "dashboard select order_items" on public.order_items for select to authenticated
  using ((select public.dashboard_role()) in ('admin', 'operator'));

create or replace function public.enforce_operator_order_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select public.dashboard_role()) is distinct from 'operator' then
    return new;
  end if;

  if (to_jsonb(new) - array[
        'status', 'quote_message', 'quote_items', 'quote_delivery_fee',
        'subtotal', 'total', 'quote_sent_at', 'quote_sent_by_email',
        'ghl_contact_id', 'ghl_sync_status', 'ghl_sync_error', 'ghl_synced_at',
        'ghl_message_id', 'ghl_conversation_id'
      ]::text[])
     is distinct from
     (to_jsonb(old) - array[
        'status', 'quote_message', 'quote_items', 'quote_delivery_fee',
        'subtotal', 'total', 'quote_sent_at', 'quote_sent_by_email',
        'ghl_contact_id', 'ghl_sync_status', 'ghl_sync_error', 'ghl_synced_at',
        'ghl_message_id', 'ghl_conversation_id'
      ]::text[]) then
    raise exception 'El operador solo puede preparar cotizaciones.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and (
    new.status not in ('cotizacion_enviada', 'no_hubo_producto')
    or new.quote_sent_at is not distinct from old.quote_sent_at
  ) then
    raise exception 'El operador no puede cambiar manualmente el estado del pedido.' using errcode = '42501';
  end if;

  return new;
end;
$$;
