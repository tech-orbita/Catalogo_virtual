-- El webhook necesita la sede del pedido y la sede de origen para decidir si
-- avisa al grupo de domicilios o a una sede. Devuelve el pedido completo.
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

  return to_jsonb(v_order);
end;
$$;
