"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDashboardRole } from "@/lib/auth/access";

export async function login(formData: FormData): Promise<{ error: string } | void> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Ingresa tu correo y contraseña." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Correo o contraseña incorrectos." };
  }

  const role = getDashboardRole(data.user);
  if (!role) {
    await supabase.auth.signOut();
    return { error: "Tu cuenta no tiene acceso habilitado al panel." };
  }

  redirect(role === "operator" ? "/admin/pedidos" : "/admin");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
