import { getDashboardRole } from "@/lib/auth/access";
import { searchCrmContacts } from "@/lib/crm";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = getDashboardRole(user);
  if (!user || (role !== "admin" && role !== "operator")) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 3) return Response.json({ contacts: [] });

  try {
    const contacts = await searchCrmContacts(query);
    return Response.json(
      { contacts },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo consultar el CRM.";
    return Response.json({ error: message }, { status: 502 });
  }
}
