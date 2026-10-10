"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, MapPin } from "lucide-react";
import { useCart } from "@/context/cart-context";
import { formatCOP } from "@/lib/currency";
import { DATA_POLICY_URL, DELIVERY_MINIMUM_SUBTOTAL } from "@/lib/messaging";
import { createOrder } from "@/actions/orders";
import { useToast } from "@/components/ui/Toast";
import type { DeliveryMethod, StoreLocation } from "@/lib/types";

const PHONE_COUNTRIES = [
  { iso: "CO", name: "Colombia", dial: "+57" },
  { iso: "VE", name: "Venezuela", dial: "+58" },
  { iso: "EC", name: "Ecuador", dial: "+593" },
  { iso: "PE", name: "Perú", dial: "+51" },
  { iso: "PA", name: "Panamá", dial: "+507" },
  { iso: "MX", name: "México", dial: "+52" },
  { iso: "CL", name: "Chile", dial: "+56" },
  { iso: "AR", name: "Argentina", dial: "+54" },
  { iso: "BR", name: "Brasil", dial: "+55" },
  { iso: "CR", name: "Costa Rica", dial: "+506" },
  { iso: "DO", name: "Rep. Dominicana", dial: "+1" },
  { iso: "US", name: "Estados Unidos", dial: "+1" },
  { iso: "CA", name: "Canadá", dial: "+1" },
  { iso: "ES", name: "España", dial: "+34" },
] as const;

export function CheckoutForm({
  locations,
}: {
  locations: StoreLocation[];
}) {
  const { items, subtotal, clear } = useCart();
  const toast = useToast();

  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("domicilio");
  const [name, setName] = useState("");
  const [cedula, setCedula] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCountryIso, setPhoneCountryIso] = useState("CO");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [addressDetails, setAddressDetails] = useState("");
  const [city, setCity] = useState("");
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [locationId, setLocationId] = useState(locations.length === 1 ? locations[0].id : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    orderNumber: number;
    locationName: string | null;
    customerConfirmationSent: boolean;
  } | null>(null);
  const selectedLocation = locations.find((location) => location.id === locationId) ?? null;
  const selectedPhoneCountry =
    PHONE_COUNTRIES.find((country) => country.iso === phoneCountryIso) ?? PHONE_COUNTRIES[0];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (items.length === 0) return;
    if (deliveryMethod === "recoger" && locations.length > 0 && !selectedLocation) {
      setError("Selecciona la sede que atenderá el pedido.");
      toast.warning("Selecciona la sede que atenderá el pedido");
      return;
    }
    if (deliveryMethod === "domicilio" && subtotal <= DELIVERY_MINIMUM_SUBTOTAL) {
      const minimumError = `Los pedidos a domicilio deben superar ${formatCOP(DELIVERY_MINIMUM_SUBTOTAL)} en productos.`;
      setError(minimumError);
      toast.warning("El pedido no alcanza el mínimo para domicilio", {
        description: minimumError,
      });
      return;
    }
    if (!privacyAccepted) {
      setError("Debes aceptar la política de tratamiento de datos para continuar.");
      toast.warning("Acepta la política de tratamiento de datos");
      return;
    }
    setSubmitting(true);
    setError(null);
    const toastId = toast.loading("Enviando tu solicitud...");

    const result = await createOrder({
      customerName: name,
      customerCedula: cedula,
      customerPhone: phone,
      phoneCountryCode: selectedPhoneCountry.dial,
      phoneCountryIso: selectedPhoneCountry.iso,
      customerEmail: email,
      locationId: deliveryMethod === "recoger" ? selectedLocation?.id : undefined,
      deliveryMethod,
      address: deliveryMethod === "domicilio" ? address : undefined,
      neighborhood: deliveryMethod === "domicilio" ? neighborhood : undefined,
      addressDetails: deliveryMethod === "domicilio" ? addressDetails : undefined,
      city: deliveryMethod === "domicilio" ? city : undefined,
      department: deliveryMethod === "domicilio" ? department : undefined,
      notes,
      privacyAccepted,
      items,
    });

    setSubmitting(false);

    if ("error" in result) {
      setError(result.error);
      toast.update(toastId, {
        variant: "error",
        title: "No pudimos crear tu pedido",
        description: result.error,
      });
      return;
    }

    setConfirmation({
      orderNumber: result.orderNumber,
      locationName: result.locationName,
      customerConfirmationSent: result.customerConfirmationSent,
    });
    clear();
    toast.update(toastId, {
      variant: "success",
      title: `Pedido #${result.orderNumber} recibido`,
      description: result.locationName
        ? `Lo atenderá la sede ${result.locationName}.`
        : "Un asesor te enviará la cotización.",
    });
  }

  if (confirmation) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-light text-2xl">
          ✓
        </div>
        <h1 className="text-xl font-semibold">¡Pedido #{confirmation.orderNumber} recibido!</h1>
        <p className="mt-2 text-sm text-[#545454]/65">
          Quedó pendiente por cotizar. Un asesor revisará los artículos y te enviará la cotización.
        </p>
        {confirmation.customerConfirmationSent && (
          <p className="mt-2 text-sm text-[#545454]/65">
            También enviamos a tu teléfono la confirmación con los datos recibidos.
          </p>
        )}
        {confirmation.locationName && (
          <p className="mt-2 rounded-full bg-orbita-cyan-soft px-3 py-1 text-xs font-semibold text-orbita-navy">
            Atendido por {confirmation.locationName}
          </p>
        )}

        <Link
          href="/"
          className="mt-6 text-sm font-medium text-[#545454]/60 hover:text-brand"
        >
          Volver al catálogo
        </Link>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
        <p className="text-sm text-[#545454]/55">Tu carrito está vacío.</p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand">
          Ir al catálogo
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <Link
        href="/carrito"
        className="mb-4 inline-flex items-center gap-1 text-sm text-[#545454]/60 hover:text-brand"
      >
        <ArrowLeft size={16} /> Volver al carrito
      </Link>

      <h1 className="mb-5 text-xl font-semibold">Finalizar pedido</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {deliveryMethod === "recoger" && locations.length > 0 && (
          <section className="space-y-3 rounded-2xl border border-orbita-cyan/30 bg-orbita-cyan-soft/45 p-4">
            <div className="flex items-start gap-2.5">
              <MapPin size={18} className="mt-0.5 shrink-0 text-orbita-cyan-dark" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold text-orbita-navy">Sede donde recogerás</h2>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">
                  La sede recibirá automáticamente el aviso de tu pedido.
                </p>
              </div>
            </div>
            <select
              required
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              className="w-full rounded-xl border border-white bg-white px-3 py-3 text-sm font-medium text-slate-800 outline-none focus:border-orbita-cyan"
            >
              <option value="">Selecciona una sede</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}{location.city ? ` · ${location.city}` : ""}
                </option>
              ))}
            </select>
            {selectedLocation && (
              <p className="rounded-xl bg-white/80 px-3 py-2 text-xs leading-5 text-slate-600">
                {selectedLocation.address}
                {(selectedLocation.city || selectedLocation.department) && (
                  <span className="block text-slate-400">
                    {[selectedLocation.city, selectedLocation.department].filter(Boolean).join(", ")}
                  </span>
                )}
              </p>
            )}
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[#545454]/80">Tus datos</h2>
          <input
            required
            placeholder="Nombre completo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[#cacaca] px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
          <input
            required
            placeholder="Número de cédula"
            value={cedula}
            onChange={(e) => setCedula(e.target.value)}
            className="w-full rounded-lg border border-[#cacaca] px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
          <div className="grid grid-cols-[minmax(128px,0.42fr)_minmax(0,1fr)] gap-2">
            <label className="sr-only" htmlFor="phone-country">País del teléfono</label>
            <select
              id="phone-country"
              value={phoneCountryIso}
              onChange={(event) => setPhoneCountryIso(event.target.value)}
              className="min-w-0 rounded-lg border border-[#cacaca] bg-white px-2.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            >
              {PHONE_COUNTRIES.map((country) => (
                <option key={country.iso} value={country.iso}>
                  {country.name} {country.dial}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="customer-phone">WhatsApp o teléfono</label>
            <input
              id="customer-phone"
              required
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="WhatsApp / Teléfono"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="min-w-0 rounded-lg border border-[#cacaca] px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
          <input
            type="email"
            placeholder="Correo electrónico (opcional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-[#cacaca] px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[#545454]/80">Entrega</h2>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setDeliveryMethod("domicilio");
                setLocationId("");
                setError(null);
              }}
              className={clsx(
                "rounded-lg border px-3 py-2.5 text-sm font-medium",
                deliveryMethod === "domicilio"
                  ? "border-brand bg-brand-light text-brand"
                  : "border-[#cacaca] text-[#545454]/70"
              )}
            >
              Domicilio
            </button>
            <button
              type="button"
              onClick={() => {
                setDeliveryMethod("recoger");
                setError(null);
              }}
              className={clsx(
                "rounded-lg border px-3 py-2.5 text-sm font-medium",
                deliveryMethod === "recoger"
                  ? "border-brand bg-brand-light text-brand"
                  : "border-[#cacaca] text-[#545454]/70"
              )}
            >
              Recoger en tienda
            </button>
          </div>

          {deliveryMethod === "domicilio" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-950">
                <p className="font-semibold">Políticas de domicilio</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>El pedido de productos debe superar {formatCOP(DELIVERY_MINIMUM_SUBTOTAL)}.</li>
                  <li>El valor final del domicilio se informa en la cotización.</li>
                  <li>Fuera de Bogotá o Soacha, el envío se cotiza aparte mediante transportadora.</li>
                </ul>
              </div>
              <input
                required
                placeholder="Dirección"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-lg border border-[#cacaca] px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
              <input
                required
                placeholder="Barrio"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                className="w-full rounded-lg border border-[#cacaca] px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
              <textarea
                required
                rows={3}
                placeholder="Indicaciones para llegar (torre, apartamento, punto de referencia...)"
                value={addressDetails}
                onChange={(e) => setAddressDetails(e.target.value)}
                className="w-full resize-y rounded-lg border border-[#cacaca] px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  placeholder="Ciudad"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full rounded-lg border border-[#cacaca] px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
                <input
                  placeholder="Departamento"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full rounded-lg border border-[#cacaca] px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
              </div>
            </div>
          )}
        </section>

        <section>
          <textarea
            placeholder="Notas del pedido (opcional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-[#cacaca] px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
        </section>

        <div className="rounded-lg bg-[#f7f7f7] p-4">
          <div className="flex justify-between text-sm">
            <span className="text-[#545454]/65">Total</span>
            <span className="font-semibold">{formatCOP(subtotal)}</span>
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-[#cacaca] bg-white p-3.5 text-sm leading-5 text-[#545454]/80">
          <input
            required
            type="checkbox"
            checked={privacyAccepted}
            onChange={(event) => setPrivacyAccepted(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#cacaca] accent-brand"
          />
          <span>
            Acepto la{" "}
            <a
              href={DATA_POLICY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand underline underline-offset-2"
            >
              política de tratamiento de datos
            </a>
            . Se abrirá en otra pestaña para conservar este formulario.
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={
            submitting ||
            !privacyAccepted ||
            (deliveryMethod === "domicilio" && subtotal <= DELIVERY_MINIMUM_SUBTOTAL)
          }
          className="w-full rounded-lg bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {submitting ? "Enviando..." : "Solicitar cotización"}
        </button>
      </form>
    </main>
  );
}
