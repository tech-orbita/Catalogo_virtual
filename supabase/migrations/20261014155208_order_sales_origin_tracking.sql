alter table public.orders
  add column if not exists sales_origin_type text,
  add column if not exists sales_origin_location_id uuid references public.store_locations(id) on delete set null,
  add column if not exists sales_origin_label text;

update public.orders
set
  sales_origin_type = case
    when location_id is not null then 'store_location'
    else 'catalogo_virtual'
  end,
  sales_origin_location_id = case
    when location_id is not null then location_id
    else null
  end,
  sales_origin_label = case
    when location_id is not null then coalesce(nullif(location_name_snapshot, ''), 'Sede')
    else 'Catálogo virtual'
  end
where sales_origin_type is null
   or sales_origin_label is null;

alter table public.orders
  alter column sales_origin_type set default 'catalogo_virtual',
  alter column sales_origin_type set not null,
  alter column sales_origin_label set default 'Catálogo virtual',
  alter column sales_origin_label set not null;

alter table public.orders
  drop constraint if exists orders_sales_origin_type_check;

alter table public.orders
  add constraint orders_sales_origin_type_check
  check (sales_origin_type in ('store_location', 'catalogo_virtual'));

create index if not exists idx_orders_sales_origin_location
  on public.orders(sales_origin_location_id);

drop function if exists public.create_order_with_items(
  text, text, text, text, text, text, text, text, text, text, text,
  numeric, numeric, uuid, text, text, text, jsonb
);

create function public.create_order_with_items(
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
  p_sales_origin_type text,
  p_sales_origin_location_id uuid,
  p_sales_origin_label text,
  p_items jsonb
) returns table(
  id uuid,
  order_number integer,
  location_name text,
  location_address text,
  whatsapp_number text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order_number integer;
  v_location public.store_locations%rowtype;
  v_sales_origin_location public.store_locations%rowtype;
  v_fallback_whatsapp text;
  v_sales_origin_type text;
  v_sales_origin_location_id uuid;
  v_sales_origin_label text;
  item jsonb;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no tiene productos.';
  end if;

  if p_delivery_method not in ('domicilio', 'recoger') then
    raise exception 'El método de entrega no es válido.';
  end if;

  if p_delivery_method = 'domicilio' then
    if coalesce(p_subtotal, 0) <= 50000 then
      raise exception 'Los pedidos a domicilio deben superar $50.000 en productos.';
    end if;
    if nullif(btrim(p_address), '') is null then
      raise exception 'La dirección es obligatoria para domicilio.';
    end if;
    if nullif(btrim(p_neighborhood), '') is null then
      raise exception 'El barrio es obligatorio para domicilio.';
    end if;
    if nullif(btrim(p_address_details), '') is null then
      raise exception 'Las indicaciones para llegar son obligatorias para domicilio.';
    end if;
  elsif p_location_id is not null then
    select * into v_location
    from public.store_locations
    where store_locations.id = p_location_id and store_locations.active = true;

    if not found then
      raise exception 'La sede seleccionada no está disponible.';
    end if;
  elsif exists (select 1 from public.store_locations where active = true) then
    raise exception 'Selecciona una sede para continuar.';
  end if;

  if p_sales_origin_type = 'store_location' and p_sales_origin_location_id is not null then
    select * into v_sales_origin_location
    from public.store_locations
    where store_locations.id = p_sales_origin_location_id;

    if not found then
      raise exception 'La sede de proveniencia no existe.';
    end if;
    v_sales_origin_type := 'store_location';
    v_sales_origin_location_id := v_sales_origin_location.id;
    v_sales_origin_label := v_sales_origin_location.name;
  elsif p_sales_origin_type = 'catalogo_virtual' then
    v_sales_origin_type := 'catalogo_virtual';
    v_sales_origin_location_id := null;
    v_sales_origin_label := 'Catálogo virtual';
  else
    raise exception 'La proveniencia del pedido público no es válida.';
  end if;

  select store_settings.whatsapp_number into v_fallback_whatsapp
  from public.store_settings
  where store_settings.id = true;

  insert into public.orders (
    customer_name, customer_cedula, customer_phone, customer_email,
    delivery_method, address, neighborhood, address_details, city, department, notes,
    subtotal, total, status, order_source,
    location_id, location_name_snapshot, location_address_snapshot,
    location_whatsapp_snapshot, ghl_contact_id, ghl_sync_status,
    ghl_sync_error, ghl_synced_at,
    sales_origin_type, sales_origin_location_id, sales_origin_label
  )
  values (
    p_customer_name, p_customer_cedula, p_customer_phone, nullif(p_customer_email, ''),
    p_delivery_method, p_address, p_neighborhood, p_address_details, p_city, p_department, p_notes,
    p_subtotal, p_total, 'pedido_realizado', 'catalogo',
    v_location.id, v_location.name, v_location.address, v_location.whatsapp_number,
    nullif(p_ghl_contact_id, ''), p_ghl_sync_status, nullif(p_ghl_sync_error, ''),
    case when p_ghl_sync_status = 'sincronizado' then now() else null end,
    v_sales_origin_type, v_sales_origin_location_id, v_sales_origin_label
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

  return query select
    v_order_id,
    v_order_number,
    v_location.name,
    v_location.address,
    coalesce(v_location.whatsapp_number, v_fallback_whatsapp);
end;
$$;

revoke all on function public.create_order_with_items(
  text, text, text, text, text, text, text, text, text, text, text,
  numeric, numeric, uuid, text, text, text, text, uuid, text, jsonb
) from public;
grant execute on function public.create_order_with_items(
  text, text, text, text, text, text, text, text, text, text, text,
  numeric, numeric, uuid, text, text, text, text, uuid, text, jsonb
) to anon, authenticated;

drop function if exists public.admin_create_order_with_items(
  text, text, text, text, text, text, text, text, text, text, text,
  numeric, numeric, uuid, text, text, text, jsonb
);

create function public.admin_create_order_with_items(
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
  p_sales_origin_type text,
  p_sales_origin_location_id uuid,
  p_sales_origin_label text,
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
  v_sales_origin_location public.store_locations%rowtype;
  v_metadata_location_id uuid;
  v_metadata_location_text text;
  v_creator_email text;
  v_sales_origin_type text;
  v_sales_origin_location_id uuid;
  v_sales_origin_label text;
  item jsonb;
begin
  if auth.uid() is null
     or coalesce(public.dashboard_role(), '') not in ('admin', 'operator') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no tiene productos.';
  end if;
  if p_delivery_method = 'domicilio' and p_location_id is not null then
    raise exception 'Los pedidos a domicilio no se asignan a una sede.';
  end if;

  if p_location_id is not null then
    select * into v_location
    from public.store_locations
    where store_locations.id = p_location_id;
    if not found then raise exception 'La sede seleccionada no existe.'; end if;
  elsif p_delivery_method = 'recoger'
    and exists (select 1 from public.store_locations where active = true) then
    raise exception 'Selecciona una sede para continuar.';
  end if;

  if p_sales_origin_type not in ('store_location', 'catalogo_virtual') then
    raise exception 'La proveniencia del pedido manual no es válida.';
  end if;
  v_creator_email := coalesce(nullif(auth.jwt()->>'email', ''), 'Usuario de dashboard');
  v_metadata_location_text := auth.jwt()->'app_metadata'->>'store_location_id';

  if v_metadata_location_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_metadata_location_id := v_metadata_location_text::uuid;
    select * into v_sales_origin_location
    from public.store_locations
    where store_locations.id = v_metadata_location_id;
  end if;

  if v_sales_origin_location.id is not null then
    v_sales_origin_type := 'store_location';
    v_sales_origin_location_id := v_sales_origin_location.id;
    v_sales_origin_label := v_sales_origin_location.name;
  elsif p_delivery_method = 'recoger' and v_location.id is not null then
    v_sales_origin_type := 'store_location';
    v_sales_origin_location_id := v_location.id;
    v_sales_origin_label := v_location.name;
  else
    v_sales_origin_type := 'catalogo_virtual';
    v_sales_origin_location_id := null;
    v_sales_origin_label := 'Catálogo virtual';
  end if;

  insert into public.orders (
    customer_name, customer_cedula, customer_phone, customer_email,
    delivery_method, address, neighborhood, address_details, city, department, notes,
    subtotal, total, status, order_source, created_by_email,
    location_id, location_name_snapshot, location_address_snapshot,
    location_whatsapp_snapshot, ghl_contact_id, ghl_sync_status,
    ghl_sync_error, ghl_synced_at,
    sales_origin_type, sales_origin_location_id, sales_origin_label
  )
  values (
    p_customer_name, p_customer_cedula, p_customer_phone, nullif(p_customer_email, ''),
    p_delivery_method, p_address, p_neighborhood, p_address_details, p_city, p_department, p_notes,
    p_subtotal, p_total, 'pedido_realizado', 'asesor', v_creator_email,
    v_location.id, v_location.name, v_location.address, v_location.whatsapp_number,
    nullif(p_ghl_contact_id, ''), p_ghl_sync_status, nullif(p_ghl_sync_error, ''),
    case when p_ghl_sync_status = 'sincronizado' then now() else null end,
    v_sales_origin_type, v_sales_origin_location_id, v_sales_origin_label
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
  numeric, numeric, uuid, text, text, text, text, uuid, text, jsonb
) from public;
grant execute on function public.admin_create_order_with_items(
  text, text, text, text, text, text, text, text, text, text, text,
  numeric, numeric, uuid, text, text, text, text, uuid, text, jsonb
) to authenticated;
