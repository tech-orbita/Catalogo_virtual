"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  ClipboardList,
  Grid3x3,
  Home,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Package,
} from "lucide-react";
import { logout } from "@/actions/auth";
import type { DashboardRole } from "@/lib/auth/access";

const links = [
  { href: "/admin", label: "Resumen", icon: LayoutDashboard, exact: true },
  { href: "/admin/home", label: "Portada", icon: Home },
  { href: "/admin/categorias", label: "Categorías", icon: Grid3x3 },
  { href: "/admin/productos", label: "Productos", icon: Package },
  { href: "/admin/pedidos", label: "Pedidos", icon: ClipboardList },
  { href: "/admin/sedes", label: "Sedes", icon: MapPinned },
];

export function AdminSidebar({ email, role }: { email: string; role: DashboardRole }) {
  const pathname = usePathname();
  const visibleLinks = role === "operator"
    ? links.filter((link) => link.href === "/admin/pedidos")
    : links;

  return (
    <header className="sticky top-0 z-40 flex min-h-14 items-stretch border-b border-slate-200 bg-white/95 shadow-[0_6px_20px_rgba(4,36,56,0.04)] backdrop-blur">
      <nav
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-3 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Navegación del dashboard"
      >
        {visibleLinks.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition sm:text-sm",
                active
                  ? "bg-orbita-cyan-soft text-orbita-navy"
                  : "text-slate-500 hover:bg-slate-100 hover:text-orbita-navy"
              )}
            >
              <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
              {label}
            </Link>
          );
        })}
      </nav>

      <form action={logout} className="flex shrink-0 items-center border-l border-slate-200 bg-white px-2">
        <button
          type="submit"
          title={`Cerrar sesión de ${email}`}
          aria-label="Cerrar sesión"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-orbita-navy"
        >
          <LogOut size={18} />
        </button>
      </form>
    </header>
  );
}
