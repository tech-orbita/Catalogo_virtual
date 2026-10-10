import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { getDashboardRole } from "@/lib/auth/access";

export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/admin/login");
  const role = getDashboardRole(user);
  if (!role) redirect("/admin/login?error=sin-acceso");

  return (
    <div className="admin-shell min-h-[100dvh] bg-orbita-canvas">
      <AdminSidebar email={user.email ?? ""} role={role} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
