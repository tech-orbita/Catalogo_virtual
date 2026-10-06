"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Search, Trash2 } from "lucide-react";
import clsx from "clsx";
import { createManualOrder } from "@/actions/orders";
import { useToast } from "@/components/ui/Toast";
import { formatCOP } from "@/lib/currency";
import type { DeliveryMethod, StoreLocation } from "@/lib/types";

export interface ManualOrderCatalogOption {
  key: string;
  productId: string;
  variantId: string | null;
  label: string;
  unitPrice: number;
}

interface DraftLine {
  id: string;
  optionKey: string;
  quantity: string;
  unitPrice: string;
}

function newLine(index: number): DraftLine {
  return { id: `line-${Date.now()}-${index}`, optionKey: "", quantity: "1", unitPrice: "" };
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CO")
    .trim();
}

function ProductSearchSelect({
  lineId,
  value,
  options,
  onChange,
}: {
  lineId: string;
  value: string;
  options: ManualOrderCatalogOption[];
  onChange: (optionKey: string) => void;
}) {
  const selected = options.find((option) => option.key === value) ?? null;
  const [query, setQuery] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = normalizeSearch(query);
  const searchTerms = normalizedQuery.split(/\s+/).filter(Boolean);
  const filteredOptions = options
    .filter((option) => {
      const label = normalizeSearch(option.label);
      return searchTerms.every((term) => label.includes(term));
    })
    .slice(0, 40);
  const listboxId = `${lineId}-product-options`;

  function choose(option: ManualOrderCatalogOption) {
    setQuery(option.label);
    onChange(option.key);
    setOpen(false);
    setActiveIndex(0);
  }

  function commitExactMatch() {
    const exact = options.find(
      (option) => normalizeSearch(option.label) === normalizeSearch(query)
    );
    if (exact) choose(exact);
  }

  return (
    <div className="relative mt-1.5">
      <div className="relative">
        <Search
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          required
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={query}
          placeholder="Escribe el nombre completo o varias palabras"
          onFocus={() => setOpen(true)}
          onBlur={() => {
            commitExactMatch();
            window.setTimeout(() => setOpen(false), 120);
          }}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            setOpen(true);
            setActiveIndex(0);
            if (selected && nextQuery !== selected.label) onChange("");
          }}
          onKeyDown={(event) => {
            if (!open && event.key === "ArrowDown") {
              setOpen(true);
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(current + 1, filteredOptions.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter" && filteredOptions[activeIndex]) {
              event.preventDefault();
              choose(filteredOptions[activeIndex]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-9 text-sm outline-none focus:border-brand"
        />
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
      </div>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={option.key === value}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
                className={clsx(
                  "block w-full rounded-lg px-3 py-2 text-left text-sm",
                  index === activeIndex ? "bg-brand-light text-brand" : "text-slate-700"
                )}
              >
                {option.label}
              </button>
            ))
          ) : (
            <p className="px-3 py-3 text-sm text-slate-500">No encontramos productos con esa búsqueda.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function ManualOrderForm({
  catalogOptions,
  locations,
}: {
  catalogOptions: ManualOrderCatalogOption[];
  locations: StoreLocation[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [customerName, setCustomerName] = useState("");
  const [customerCedula, setCustomerCedula] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("domicilio");
  const [locationId, setLocationId] = useState(locations.length === 1 ? locations[0].id : "");
  const [address, setAddress] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [addressDetails, setAddressDetails] = useState("");
  const [city, setCity] = useState("");
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { id: "line-initial", optionKey: "", quantity: "1", unitPrice: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optionByKey = useMemo(
    () => new Map(catalogOptions.map((option) => [option.key, option])),
    [catalogOptions]
  );
  const total = lines.reduce((sum, line) => {
    const quantity = Number(line.quantity);
    const price = Number(line.unitPrice);
    return sum + (Number.isFinite(quantity * price) ? quantity * price : 0);
  }, 0);

  function updateLine(id: string, patch: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...patch } : line))
    );
  }

  function selectProduct(lineId: string, optionKey: string) {
    const option = optionByKey.get(optionKey);
    updateLine(lineId, {
      optionKey,
      unitPrice: option ? String(option.unitPrice) : "",
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const items = lines.map((line) => {
      const option = optionByKey.get(line.optionKey);
      return {
        productId: option?.productId ?? "",
        variantId: option?.variantId ?? null,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
      };
    });

    const result = await createManualOrder({
      customerName,
      customerCedula,
      customerPhone,
      customerEmail,
      locationId: locationId || undefined,
      deliveryMethod,
      address: deliveryMethod === "domicilio" ? address : undefined,
      neighborhood: deliveryMethod === "domicilio" ? neighborhood : undefined,
      addressDetails: deliveryMethod === "domicilio" ? addressDetails : undefined,
      city: deliveryMethod === "domicilio" ? city : undefined,
      department: deliveryMethod === "domicilio" ? department : undefined,
      notes,
      items,
    });

    setSubmitting(false);
    if ("error" in result) {
      setError(result.error);
      toast.error("No se pudo crear el pedido", { description: result.error });
      return;
    }

    toast.success(`Pedido #${result.orderNumber} creado`, {
      description: `${customerName.trim()} · ${formatCOP(result.subtotal)}`,
    });
    if (result.warning) {
      toast.warning("Revisa la sincronización con el CRM", { description: result.warning });
    }

    router.push(`/admin/pedidos/${result.orderId}`);
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
      <div className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="font-semibold text-slate-950">Datos del cliente</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Al guardar, estos datos se crearán o actualizarán en el CRM de Órbita IA.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600 sm:col-span-2">
              Nombre completo
              <input
                required
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              WhatsApp / teléfono
              <input
                required
                type="tel"
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
                placeholder="Ej. 3001234567"
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Cédula
              <input
                required
                value={customerCedula}
                onChange={(event) => setCustomerCedula(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="text-xs font-medium text-slate-600 sm:col-span-2">
              Correo electrónico <span className="font-normal text-slate-400">(opcional)</span>
              <input
                type="email"
                value={customerEmail}
                onChange={(event) => setCustomerEmail(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand"
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-950">Artículos</h2>
              <p className="mt-1 text-xs text-slate-500">Puedes ajustar el precio antes de crear la solicitud.</p>
            </div>
            <button
              type="button"
              onClick={() => setLines((current) => [...current, newLine(current.length)])}
              className="flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-orbita-navy hover:border-orbita-cyan"
            >
              <Plus size={16} /> Artículo
            </button>
          </div>

          <div className="space-y-3">
            {lines.map((line, index) => (
              <div
                key={line.id}
                className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-3 sm:grid-cols-[minmax(0,1fr)_90px_130px_42px] sm:items-end"
              >
                <div className="text-xs font-medium text-slate-600">
                  <span>Producto</span>
                  <ProductSearchSelect
                    lineId={line.id}
                    value={line.optionKey}
                    options={catalogOptions}
                    onChange={(optionKey) => selectProduct(line.id, optionKey)}
                  />
                </div>
                <label className="text-xs font-medium text-slate-600">
                  Cantidad
                  <input
                    required
                    min={1}
                    max={999}
                    type="number"
                    value={line.quantity}
                    onChange={(event) => updateLine(line.id, { quantity: event.target.value })}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-sm outline-none focus:border-brand"
                  />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Precio unitario
                  <input
                    required
                    min={0}
                    step="0.01"
                    type="number"
                    value={line.unitPrice}
                    onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-sm outline-none focus:border-brand"
                  />
                </label>
                <button
                  type="button"
                  disabled={lines.length === 1}
                  onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}
                  aria-label={`Eliminar artículo ${index + 1}`}
                  className="flex h-10 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="mb-4 font-semibold text-slate-950">Entrega</h2>
          <div className="grid grid-cols-2 gap-2">
            {(["domicilio", "recoger"] as DeliveryMethod[]).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setDeliveryMethod(method)}
                className={clsx(
                  "rounded-xl border px-3 py-2.5 text-sm font-semibold",
                  deliveryMethod === method
                    ? "border-brand bg-brand-light text-brand"
                    : "border-slate-200 text-slate-500"
                )}
              >
                {method === "domicilio" ? "Domicilio" : "Recoger en tienda"}
              </button>
            ))}
          </div>

          {locations.length > 0 && (
            <label className="mt-4 block text-xs font-medium text-slate-600">
              Sede
              <select
                required
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand"
              >
                <option value="">Selecciona una sede</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {deliveryMethod === "domicilio" && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                Dirección
                <input
                  required
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand"
                />
              </label>
              <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                Barrio
                <input
                  required
                  value={neighborhood}
                  onChange={(event) => setNeighborhood(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand"
                />
              </label>
              <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                Indicaciones para llegar
                <textarea
                  required
                  rows={3}
                  value={addressDetails}
                  onChange={(event) => setAddressDetails(event.target.value)}
                  className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand"
                />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Ciudad
                <input
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand"
                />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Departamento
                <input
                  value={department}
                  onChange={(event) => setDepartment(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand"
                />
              </label>
            </div>
          )}
        </section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-36 xl:self-start">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <label className="text-xs font-medium text-slate-600">
            Notas internas o del cliente
            <textarea
              rows={5}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand"
            />
          </label>
        </section>

        <section className="rounded-2xl bg-orbita-navy p-5 text-white">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-orbita-cyan">Total estimado</p>
          <p className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{formatCOP(total)}</p>
          <p className="mt-3 text-xs leading-5 text-white/50">
            El pedido quedará pendiente para que prepares la cotización desde su detalle.
          </p>
          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-red-500/15 px-3 py-2.5 text-sm text-red-100">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || catalogOptions.length === 0}
            className="mt-5 min-h-12 w-full rounded-xl bg-orbita-cyan px-4 py-3 text-sm font-semibold text-orbita-navy transition hover:bg-[#78c5d7] disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? "Creando pedido..." : "Crear pedido manual"}
          </button>
        </section>
      </aside>
    </form>
  );
}
