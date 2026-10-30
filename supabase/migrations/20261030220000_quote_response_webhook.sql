-- Operadores: pueden mover el pedido de etapa y cambiar el pago desde el dashboard.
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
        'status', 'payment_status', 'quote_message', 'quote_items', 'quote_delivery_fee',
        'subtotal', 'total', 'quote_sent_at', 'quote_sent_by_email',
        'ghl_contact_id', 'ghl_sync_status', 'ghl_sync_error', 'ghl_synced_at',
        'ghl_message_id', 'ghl_conversation_id'
      ]::text[])
     is distinct from
     (to_jsonb(old) - array[
        'status', 'payment_status', 'quote_message', 'quote_items', 'quote_delivery_fee',
        'subtotal', 'total', 'quote_sent_at', 'quote_sent_by_email',
        'ghl_contact_id', 'ghl_sync_status', 'ghl_sync_error', 'ghl_synced_at',
        'ghl_message_id', 'ghl_conversation_id'
      ]::text[]) then
    raise exception 'El operador solo puede gestionar cotizaciones y etapas.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop policy if exists "admins can update quote attempts" on public.order_quote_attempts;
drop policy if exists "dashboard users can update quote attempts" on public.order_quote_attempts;
create policy "dashboard users can update quote attempts"
  on public.order_quote_attempts
  for update
  to authenticated
  using ((select public.dashboard_role()) in ('admin', 'operator'))
  with check ((select public.dashboard_role()) in ('admin', 'operator'));

-- Webhook de Órbita: el cliente aprueba o rechaza la cotización con los botones
-- de WhatsApp. El secreto solo se guarda como hash SHA-256; el valor real vive
-- en ORBITA_QUOTE_WEBHOOK_SECRET del despliegue.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.integration_secrets (
  name text primary key,
  secret_hash text not null,
  updated_at timestamptz not null default now()
);

create or replace function private.integration_secret_valid(p_name text, p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.integration_secrets s
    where s.name = p_name
      and coalesce(length(p_secret), 0) >= 32
      and s.secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
  );
$$;

/**
 * Toma la cotización enviada más reciente del contacto y la marca aceptada o no
 * aceptada. El cambio es atómico, así un webhook repetido no duplica el aviso.
 */
create or replace function public.integration_claim_quote_response(
  p_secret text,
  p_contact_id text,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if not private.integration_secret_valid('quote_webhook', p_secret) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if p_decision not in ('aprobar', 'rechazar') then
    raise exception 'Decisión inválida.' using errcode = '22023';
  end if;

  select o.* into v_order
  from public.orders o
  where o.ghl_contact_id = p_contact_id
    and o.status = 'cotizacion_enviada'
  order by o.quote_sent_at desc nulls last, o.created_at desc
  limit 1
  for update skip locked;

  if not found then
    return null;
  end if;

  update public.orders
  set status = case when p_decision = 'aprobar' then 'cotizacion_aceptada' else 'cotizacion_no_aceptada' end
  where id = v_order.id;

  return jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'customer_name', v_order.customer_name,
    'customer_cedula', v_order.customer_cedula,
    'customer_phone', v_order.customer_phone,
    'total', v_order.total,
    'delivery_method', v_order.delivery_method,
    'location_name_snapshot', v_order.location_name_snapshot
  );
end;
$$;

/**
 * Cierra la aceptación: registra el aviso al grupo o, si no se pudo enviar,
 * devuelve el pedido a cotización enviada para no dejarlo aceptado sin aviso.
 */
create or replace function public.integration_finish_quote_acceptance(
  p_secret text,
  p_order_id uuid,
  p_notified boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.integration_secret_valid('quote_webhook', p_secret) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  if p_notified then
    update public.order_quote_attempts
    set accepted_notified_at = now()
    where id = (
      select a.id
      from public.order_quote_attempts a
      where a.order_id = p_order_id and a.status = 'requested'
      order by a.revision desc
      limit 1
    );
  else
    update public.orders
    set status = 'cotizacion_enviada'
    where id = p_order_id and status = 'cotizacion_aceptada';
  end if;
end;
$$;

revoke all on function private.integration_secret_valid(text, text) from public, anon, authenticated;
revoke all on function public.integration_claim_quote_response(text, text, text) from public;
revoke all on function public.integration_finish_quote_acceptance(text, uuid, boolean) from public;
grant execute on function public.integration_claim_quote_response(text, text, text) to anon;
grant execute on function public.integration_finish_quote_acceptance(text, uuid, boolean) to anon;
