-- Roles internos del dashboard:
--   admin    -> catálogo, sedes, pedidos y cotizaciones
--   operator -> lectura de pedidos y preparación de cotizaciones
-- Los roles viven en auth.users.raw_app_meta_data y llegan firmados en el JWT.

drop policy if exists "admin all categories" on public.categories;
create policy "admin all categories" on public.categories for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "admin all products" on public.products;
create policy "admin all products" on public.products for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "admin all product_categories" on public.product_categories;
create policy "admin all product_categories" on public.product_categories for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "admin all product_variants" on public.product_variants;
create policy "admin all product_variants" on public.product_variants for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "admin all product_images" on public.product_images;
create policy "admin all product_images" on public.product_images for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "admin all media_assets" on public.media_assets;
create policy "admin all media_assets" on public.media_assets for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "admin all store_settings" on public.store_settings;
create policy "admin all store_settings" on public.store_settings for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "admin all store locations" on public.store_locations;
create policy "admin all store locations" on public.store_locations for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "admin select orders" on public.orders;
create policy "dashboard select orders" on public.orders for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'operator'));

drop policy if exists "admin update orders" on public.orders;
create policy "dashboard update orders" on public.orders for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'operator'))
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'operator'));

drop policy if exists "admin select order_items" on public.order_items;
create policy "dashboard select order_items" on public.order_items for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'operator'));

drop policy if exists "admin write product-images" on storage.objects;
create policy "admin write product-images" on storage.objects for all to authenticated
  using (bucket_id = 'product-images' and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check (bucket_id = 'product-images' and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "admin write store-assets" on storage.objects;
create policy "admin write store-assets" on storage.objects for all to authenticated
  using (bucket_id = 'store-assets' and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check (bucket_id = 'store-assets' and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create or replace function public.enforce_operator_order_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.jwt() -> 'app_metadata' ->> 'role') <> 'operator' then
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

revoke all on function public.enforce_operator_order_update() from public;

drop trigger if exists enforce_operator_order_update on public.orders;
create trigger enforce_operator_order_update
before update on public.orders
for each row execute function public.enforce_operator_order_update();

create or replace function public.admin_create_order_with_items(
  p_customer_name text,
  p_customer_cedula text,
  p_customer_phone text,
  p_customer_email text,
  p_delivery_method text,
  p_address text,
  p_neighborhood text,
  p_address_details text,
  p_city text,
  p_department text,
  p_notes text,
  p_subtotal numeric,
  p_total numeric,
  p_location_id uuid,
  p_ghl_contact_id text,
  p_ghl_sync_status text,
  p_ghl_sync_error text,
  p_items jsonb
) returns table(id uuid, order_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order_number integer;
  v_location public.store_locations%rowtype;
  item jsonb;
begin
  if auth.uid() is null
     or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no tiene productos.';
  end if;

  if p_location_id is not null then
    select * into v_location
    from public.store_locations
    where store_locations.id = p_location_id;
    if not found then raise exception 'La sede seleccionada no existe.'; end if;
  end if;

  insert into public.orders (
    customer_name, customer_cedula, customer_phone, customer_email,
    delivery_method, address, neighborhood, address_details, city, department, notes,
    subtotal, total, status, order_source, created_by_email,
    location_id, location_name_snapshot, location_address_snapshot,
    location_whatsapp_snapshot, ghl_contact_id, ghl_sync_status,
    ghl_sync_error, ghl_synced_at
  )
  values (
    p_customer_name, p_customer_cedula, p_customer_phone, nullif(p_customer_email, ''),
    p_delivery_method, p_address, p_neighborhood, p_address_details, p_city, p_department, p_notes,
    p_subtotal, p_total, 'pedido_realizado', 'asesor', auth.jwt()->>'email',
    v_location.id, v_location.name, v_location.address, v_location.whatsapp_number,
    nullif(p_ghl_contact_id, ''), p_ghl_sync_status, nullif(p_ghl_sync_error, ''),
    case when p_ghl_sync_status = 'sincronizado' then now() else null end
  )
  returning orders.id, orders.order_number into v_order_id, v_order_number;

  for item in select * from jsonb_array_elements(p_items) loop
    insert into public.order_items (
      order_id, product_id, variant_id, product_name_snapshot,
      variant_label_snapshot, quantity, unit_price, subtotal
    )
    values (
      v_order_id,
      nullif(item->>'product_id', '')::uuid,
      nullif(item->>'variant_id', '')::uuid,
      item->>'product_name_snapshot',
      nullif(item->>'variant_label_snapshot', ''),
      (item->>'quantity')::integer,
      (item->>'unit_price')::numeric,
      (item->>'subtotal')::numeric
    );
  end loop;

  return query select v_order_id, v_order_number;
end;
$$;

revoke all on function public.admin_create_order_with_items(
  text, text, text, text, text, text, text, text, text, text, text,
  numeric, numeric, uuid, text, text, text, jsonb
) from public;
grant execute on function public.admin_create_order_with_items(
  text, text, text, text, text, text, text, text, text, text, text,
  numeric, numeric, uuid, text, text, text, jsonb
) to authenticated;
