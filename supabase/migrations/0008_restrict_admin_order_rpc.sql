-- El RPC administrativo valida auth.uid(), pero una concesión histórica daba
-- EXECUTE explícito a anon. Se revoca para que ni siquiera quede expuesto a
-- sesiones anónimas por PostgREST.

revoke execute on function public.admin_create_order_with_items(
  text, text, text, text, text, text, text, text, text, text,
  numeric, numeric, uuid, text, text, text, jsonb
) from anon;

grant execute on function public.admin_create_order_with_items(
  text, text, text, text, text, text, text, text, text, text,
  numeric, numeric, uuid, text, text, text, jsonb
) to authenticated;
