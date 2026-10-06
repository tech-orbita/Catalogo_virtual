"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, ExternalLink, LockKeyhole, ShieldCheck } from "lucide-react";
import { login } from "@/actions/auth";
import { useToast } from "@/components/ui/Toast";

export default function AdminLoginPage() {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setError(null);
    const result = await login(formData);
    setSubmitting(false);

    if (result && "error" in result) {
      setError(result.error);
      toast.error("No pudimos iniciar tu sesión", { description: result.error });
    }
  }

  return (
    <main className="admin-shell min-h-[100dvh] overflow-x-hidden bg-orbita-navy">
      <div className="grid min-h-[100dvh] lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden overflow-hidden px-10 py-10 lg:flex lg:flex-col lg:justify-between xl:px-16">
          <div className="absolute -left-32 top-1/3 h-80 w-80 rounded-full bg-orbita-cyan/15 blur-3xl" />
          <div className="absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />

          <div className="relative max-w-xl pb-12">
            <p className="mb-5 text-sm font-medium uppercase tracking-[0.2em] text-orbita-cyan">
              Operación de catálogo
            </p>
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-[-0.04em] text-white xl:text-6xl">
              Tu catálogo listo para vender y operar.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-white/60">
              Actualiza productos, prepara cotizaciones y revisa pedidos sin salir de tu panel de Órbita IA.
            </p>

            <div className="mt-10 grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-white/10">
              {["Productos", "Cotizaciones", "Pedidos"].map((item) => (
                <div key={item} className="bg-white/[0.04] px-4 py-5 text-sm text-white/70">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <p className="relative text-xs text-white/35">Tecnología operativa por Órbita IA</p>
        </section>

        <section className="relative flex min-h-[100dvh] items-center justify-center bg-[#f5f8fa] px-5 py-10 sm:px-8">
          <div className="admin-enter w-full max-w-md">
            <div className="mb-8">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-orbita-cyan-soft text-orbita-cyan-dark">
                <LockKeyhole size={22} />
              </div>
              <h2 className="text-3xl font-semibold tracking-[-0.03em] text-slate-950">
                Inicia sesión
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Accede al panel operativo de tu catálogo. La sesión se conserva dentro de esta subcuenta.
              </p>
            </div>

            <form action={handleSubmit} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_24px_70px_-32px_rgba(15,38,60,0.35)] sm:p-7">
              <div className="space-y-5">
                <label className="block text-sm font-medium text-slate-700">
                  Correo electrónico
                  <input
                    required
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder="nombre@empresa.com"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-base text-slate-950 outline-none transition focus:border-orbita-cyan-dark focus:ring-4 focus:ring-orbita-cyan/15"
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Contraseña
                  <input
                    required
                    type="password"
                    name="password"
                    minLength={6}
                    autoComplete="current-password"
                    placeholder="Tu contraseña"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-base text-slate-950 outline-none transition focus:border-orbita-cyan-dark focus:ring-4 focus:ring-orbita-cyan/15"
                  />
                </label>
              </div>

              {error && (
                <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-700">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-orbita-navy px-4 py-3 text-sm font-semibold text-white transition hover:bg-orbita-navy-soft focus:outline-none focus:ring-4 focus:ring-orbita-cyan/25 disabled:cursor-wait disabled:opacity-60"
              >
                {submitting ? "Ingresando..." : "Entrar al dashboard"}
                {!submitting && <ArrowRight size={17} />}
              </button>

              <div className="mt-5 flex items-start gap-2 border-t border-slate-100 pt-5 text-xs leading-5 text-slate-500">
                <ShieldCheck className="mt-0.5 shrink-0 text-orbita-cyan-dark" size={16} />
                <span>Acceso protegido con Supabase. Cierra sesión únicamente al terminar en un equipo compartido.</span>
              </div>
            </form>

            <Link
              href="/"
              target="_blank"
              rel="noreferrer"
              className="mt-6 flex items-center justify-center gap-2 text-sm font-medium text-slate-500 transition hover:text-orbita-navy"
            >
              Ver catálogo público
              <ExternalLink size={15} />
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
