"use client";

import { useState, useTransition } from "react";
import { ModalPortal } from "./ModalPortal";
import { useRouter } from "next/navigation";
import {
  Building2,
  MapPin,
  MessageCircle,
  Pencil,
  Plus,
  Store,
  Trash2,
  X,
} from "lucide-react";
import {
  createStoreLocation,
  deleteStoreLocation,
  setStoreLocationActive,
  updateStoreLocation,
  type StoreLocationInput,
} from "@/actions/locations";
import { useToast } from "@/components/ui/Toast";
import type { StoreLocation } from "@/lib/types";

function LocationToggle({ location }: { location: StoreLocation }) {
  const router = useRouter();
  const toast = useToast();
  const [checked, setChecked] = useState(location.active);
  const [pending, startTransition] = useTransition();

  function handleChange() {
    const next = !checked;
    setChecked(next);
    startTransition(async () => {
      const result = await setStoreLocationActive(location.id, next);
      if (result && "error" in result) {
        setChecked(!next);
        toast.error("No se pudo cambiar la visibilidad de la sede", {
          description: result.error,
        });
        return;
      }
      toast.success(next ? "Sede activada" : "Sede oculta en el checkout", {
        description: location.name,
      });
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${checked ? "Desactivar" : "Activar"} ${location.name}`}
      disabled={pending}
      onClick={handleChange}
      className={`relative h-[22px] w-10 overflow-hidden rounded-full transition-colors disabled:cursor-wait disabled:opacity-60 ${
        checked ? "bg-orbita-cyan-dark" : "bg-slate-200"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function LocationModal({
  location,
  onClose,
}: {
  location: StoreLocation | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<StoreLocationInput>({
    name: location?.name ?? "",
    address: location?.address ?? "",
    city: location?.city ?? "Bogotá",
    department: location?.department ?? "Cundinamarca",
    whatsappNumber: location?.whatsapp_number ?? "57",
    active: location?.active ?? true,
  });
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField<K extends keyof StoreLocationInput>(key: K, value: StoreLocationInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const result = location
      ? await updateStoreLocation(location.id, form)
      : await createStoreLocation(form);
    setSaving(false);
    if (result && "error" in result) {
      const message = result.error ?? "No fue posible guardar la sede.";
      setError(message);
      toast.error(location ? "No se pudo actualizar la sede" : "No se pudo crear la sede", {
        description: message,
      });
      return;
    }
    toast.success(location ? "Sede actualizada" : "Sede creada", {
      description: form.name.trim(),
    });
    onClose();
  }

  const inputClass =
    "mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none transition focus:border-orbita-cyan focus:ring-2 focus:ring-orbita-cyan/15";

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/45 p-4 sm:items-center sm:p-6"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <form
          onSubmit={handleSubmit}
          role="dialog"
          aria-modal="true"
          aria-labelledby="location-modal-title"
          className="my-auto w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl sm:p-6"
        >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orbita-cyan-dark">
              Enrutamiento de pedidos
            </p>
            <h2 id="location-modal-title" className="mt-1 text-xl font-semibold text-slate-950">
              {location ? "Editar sede" : "Nueva sede"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">
            Nombre de la sede
            <input
              autoFocus
              required
              value={form.name}
              onChange={(event) => setField("name", event.target.value)}
              placeholder="Ej. Castellana"
              className={inputClass}
            />
          </label>
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">
            Dirección
            <input
              required
              value={form.address}
              onChange={(event) => setField("address", event.target.value)}
              placeholder="Ej. Cra. 49 # 95-20"
              className={inputClass}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Ciudad
            <input
              value={form.city}
              onChange={(event) => setField("city", event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Departamento
            <input
              value={form.department}
              onChange={(event) => setField("department", event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">
            WhatsApp que recibirá los pedidos
            <input
              required
              inputMode="tel"
              value={form.whatsappNumber}
              onChange={(event) => setField("whatsappNumber", event.target.value)}
              placeholder="573001234567"
              className={inputClass}
            />
            <span className="mt-1.5 block text-xs font-normal text-slate-400">
              Usa formato internacional: 57 seguido del número, sin el símbolo +.
            </span>
          </label>
        </div>

        <label className="mt-4 flex items-center gap-3 rounded-xl bg-slate-50 px-3.5 py-3 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => setField("active", event.target.checked)}
            className="h-4 w-4 accent-orbita-cyan-dark"
          />
          Mostrar esta sede en el checkout
        </label>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 rounded-xl bg-orbita-navy px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-orbita-navy-soft disabled:opacity-60"
          >
            {saving ? "Guardando..." : "Guardar sede"}
          </button>
        </div>
        </form>
      </div>
    </ModalPortal>
  );
}

export function LocationsManager({ initial }: { initial: StoreLocation[] }) {
  const router = useRouter();
  const toast = useToast();
  const [modal, setModal] = useState<StoreLocation | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeCount = initial.filter((location) => location.active).length;

  async function handleDelete(location: StoreLocation) {
    if (!confirm(`¿Eliminar la sede “${location.name}”? Los pedidos anteriores conservarán sus datos.`)) return;
    setError(null);
    const result = await deleteStoreLocation(location.id);
    if (result && "error" in result) {
      const message = result.error ?? "No fue posible eliminar la sede.";
      setError(message);
      toast.error("No se pudo eliminar la sede", { description: message });
      return;
    }
    toast.success("Sede eliminada", { description: location.name });
    router.refresh();
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:max-w-xl">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <Building2 size={18} className="text-orbita-cyan-dark" aria-hidden="true" />
          <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">{initial.length}</p>
          <p className="text-xs text-slate-500">Sedes configuradas</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <Store size={18} className="text-emerald-600" aria-hidden="true" />
          <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">{activeCount}</p>
          <p className="text-xs text-slate-500">Disponibles al público</p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-950">Directorio de sedes</h2>
          <p className="mt-1 text-sm text-slate-500">
            El WhatsApp de la sede elegida recibirá el resumen del pedido.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal("new")}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orbita-cyan px-4 py-2.5 text-sm font-semibold text-orbita-navy transition hover:bg-[#78c5d7]"
        >
          <Plus size={17} aria-hidden="true" />
          Agregar sede
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {initial.length > 0 ? (
        <div className="mt-4 grid grid-flow-dense grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {initial.map((location) => (
            <article key={location.id} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold text-slate-950">{location.name}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      location.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}>
                      {location.active ? "Activa" : "Oculta"}
                    </span>
                  </div>
                  <p className="mt-3 flex items-start gap-2 text-sm leading-5 text-slate-600">
                    <MapPin size={16} className="mt-0.5 shrink-0 text-orbita-cyan-dark" aria-hidden="true" />
                    <span>
                      {location.address}
                      {(location.city || location.department) && (
                        <span className="block text-xs text-slate-400">
                          {[location.city, location.department].filter(Boolean).join(", ")}
                        </span>
                      )}
                    </span>
                  </p>
                  <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                    <MessageCircle size={16} className="shrink-0 text-emerald-600" aria-hidden="true" />
                    +{location.whatsapp_number}
                  </p>
                </div>
                <LocationToggle location={location} />
              </div>
              <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setModal(location)}
                  className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-orbita-cyan-soft hover:text-orbita-navy"
                >
                  <Pencil size={15} aria-hidden="true" />
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(location)}
                  aria-label={`Eliminar ${location.name}`}
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center">
          <Building2 size={28} className="mx-auto text-slate-300" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-slate-700">Todavía no hay sedes configuradas</p>
          <p className="mt-1 text-sm text-slate-500">
            Agrega las 8 sedes de Organic Nails con su dirección y WhatsApp.
          </p>
        </div>
      )}

      {modal && (
        <LocationModal
          location={modal === "new" ? null : modal}
          onClose={() => {
            setModal(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
