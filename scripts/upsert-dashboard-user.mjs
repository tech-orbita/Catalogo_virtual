// Creates a dashboard user or updates the role of an existing user.
// Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_EMAIL, DASHBOARD_ROLE
// DASHBOARD_PASSWORD is required only when the user does not exist.
import { createClient } from "@supabase/supabase-js";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DASHBOARD_EMAIL", "DASHBOARD_ROLE"];
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`Falta ${name}.`);
}

const email = process.env.DASHBOARD_EMAIL.trim().toLowerCase();
const role = process.env.DASHBOARD_ROLE.trim();
if (!new Set(["admin", "operator"]).has(role)) {
  throw new Error("DASHBOARD_ROLE debe ser admin u operator.");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

let existing = null;
for (let page = 1; !existing; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  existing = data.users.find((user) => user.email?.toLowerCase() === email) ?? null;
  if (data.users.length < 200) break;
}

if (existing) {
  const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
    app_metadata: { ...existing.app_metadata, role },
  });
  if (error) throw error;
  console.log(JSON.stringify({ action: "updated", id: data.user.id, email, role }));
  process.exit(0);
}

const password = process.env.DASHBOARD_PASSWORD;
if (!password) throw new Error("Falta DASHBOARD_PASSWORD para crear el usuario.");

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: { role },
});
if (error) throw error;
console.log(JSON.stringify({ action: "created", id: data.user.id, email, role }));
