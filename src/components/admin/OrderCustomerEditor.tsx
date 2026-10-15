"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save, UserRound, X } from "lucide-react";
import { updateOrderCustomer } from "@/actions/orders";
import { useToast } from "@/components/ui/Toast";
import type { OrderWithItems } from "@/lib/types";

export function OrderCustomerEditor({ order }: { order: OrderWithItems }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState(order.customer_name);
  const [customerCedula, setCustomerCedula] = useState(order.customer_cedula);
  const [customerPhone, setCustomerPhone] = useState(order.customer_phone);
  const [customerEmail, setCustomerEmail] = useState(order.customer_email ?? "");
  const [address, setAddress] = useState(order.address ?? "");
  const [neighborhood, setNeighborhood] = useState(order.neighborhood ?? "");
  const [addressDetails, setAddressDetails] = useState(order.address_details ?? "");
  const [city, setCity] = useState(order.city ?? "");
  const [department, setDepartment] = useState(order.department ?? "");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const result = await updateOrderCustomer(order.id, {
      customerName,
      customerCedula,
      customerPhone,
      customerEmail,
      address: order.delivery_method === "domicilio" ? address : undefined,
      neighborhood: order.delivery_method === "domicilio" ? neighborhood : undefined,
      addressDetails: order.delivery_method === "domicilio" ? addressDetails : undefined,
      city: order.delivery_method === "domicilio" ? city : undefined,
      department: order.delivery_method === "domicilio" ? department : undefined,
    });
    setSaving(false);

    if ("error" in result && result.error) {
      setError(result.error);
      toast.error("No se pudieron actualizar los datos del cliente", {
        description: result.error,
      });
      return;
    }

    const warning = "warning" in result ? result.warning : undefined;
    setEditing(false);
    if (warning) {
      toast.warning("Pedido actualizado con una novedad", { description: warning });
    } else {
      toast.success("Datos del cliente actualizados", {
        description: "El pedido y el contacto del CRM quedaron sincronizados.",
      });
    }
    router.refresh();
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand">
            <UserRound size={19} aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-semibold text-orbita-navy">Datos de contacto y entrega</h2>
            <p className="mt-1 text-sm text-slate-600">
              Los cambios se guardan en este pedido y en su contacto del CRM.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing((current) => !current);
            setError(null);
          }}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-orbita-navy hover:border-orbita-cyan"
        >
          {editing ? <X size={16} /> : <Pencil size={16} />}
          {editing ? "Cancelar" : "Editar información"}
        </button>
      </div>

      {editing ? (
        <form onSubmit={handleSubmit} className="p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600 sm:col-span-2">
              Nombre completo
              <input required value={customerName} onChange={(event) => setCustomerName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand" />
            </label>
            <label className="text-xs font-medium text-slate-600">
              WhatsApp / teléfono
              <input required type="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand" />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Cédula
              <input required value={customerCedula} onChange={(event) => setCustomerCedula(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand" />
            </label>
            <label className="text-xs font-medium text-slate-600 sm:col-span-2">
              Correo electrónico <span className="font-normal text-slate-400">(opcional)</span>
              <input type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand" />
            </label>

            {order.delivery_method === "domicilio" ? (
              <>
                <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                  Dirección
                  <input required value={address} onChange={(event) => setAddress(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                  Barrio
                  <input required value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                  Indicaciones para llegar
                  <textarea required rows={3} value={addressDetails} onChange={(event) => setAddressDetails(event.target.value)} className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Ciudad
                  <input value={city} onChange={(event) => setCity(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Departamento
                  <input value={department} onChange={(event) => setDepartment(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
              </>
            ) : null}
          </div>

          {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p> : null}
          <div className="mt-4 flex justify-end">
            <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-orbita-navy px-4 text-sm font-semibold text-white hover:bg-orbita-navy/90 disabled:cursor-wait disabled:opacity-60">
              <Save size={16} /> {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid gap-4 p-4 text-sm sm:grid-cols-2 sm:p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cliente</p>
            <p className="mt-1 font-semibold text-slate-900">{customerName}</p>
            <p className="mt-1 text-slate-600">{customerPhone}</p>
            <p className="text-slate-600">Cédula: {customerCedula}</p>
            {customerEmail ? <p className="text-slate-600">{customerEmail}</p> : null}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Entrega</p>
            <p className="mt-1 font-semibold text-slate-900">{order.delivery_method === "domicilio" ? "Domicilio" : "Recoger en tienda"}</p>
            {order.delivery_method === "domicilio" ? (
              <>
                <p className="mt-1 text-slate-600">{address || "Sin dirección"}</p>
                {neighborhood ? <p className="text-slate-600">Barrio: {neighborhood}</p> : null}
                {addressDetails ? <p className="text-slate-600">{addressDetails}</p> : null}
                {[city, department].filter(Boolean).length > 0 ? <p className="text-slate-600">{[city, department].filter(Boolean).join(", ")}</p> : null}
              </>
            ) : (
              <p className="mt-1 text-slate-600">{order.location_name_snapshot || "Sede definida en el pedido"}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
