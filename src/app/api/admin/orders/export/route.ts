import * as XLSX from "xlsx";
import { NextRequest, NextResponse } from "next/server";
import { getDashboardRole } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/types";
import type { Order, OrderStatus, PaymentStatus } from "@/lib/types";

const PAGE_SIZE = 1_000;

function safeSearch(value: string) {
  return value.replace(/[,%()]/g, " ").trim();
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = getDashboardRole(user);
  if (!user || (role !== "admin" && role !== "operator")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const search = safeSearch(request.nextUrl.searchParams.get("search") ?? "");
  const status = request.nextUrl.searchParams.get("estado") as OrderStatus | null;
  const paymentStatus = request.nextUrl.searchParams.get("pago") as PaymentStatus | null;
  const locationId = request.nextUrl.searchParams.get("sede");
  const orders: Order[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (status && status in ORDER_STATUS_LABELS) query = query.eq("status", status);
    if (paymentStatus && paymentStatus in PAYMENT_STATUS_LABELS) {
      query = query.eq("payment_status", paymentStatus);
    }
    if (locationId === "sin_sede") query = query.is("sales_origin_location_id", null);
    else if (locationId) query = query.eq("sales_origin_location_id", locationId);
    if (search) {
      const asNumber = Number(search);
      const filters = [
        `customer_name.ilike.%${search}%`,
        `customer_phone.ilike.%${search}%`,
        `customer_cedula.ilike.%${search}%`,
      ];
      if (Number.isFinite(asNumber)) filters.unshift(`order_number.eq.${asNumber}`);
      query = query.or(filters.join(","));
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        { error: `No se pudieron exportar los pedidos: ${error.message}` },
        { status: 500 }
      );
    }
    orders.push(...((data ?? []) as Order[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const rows = orders.map((order) => ({
    PEDIDO: String(order.order_number),
    FECHA: new Date(order.created_at).toLocaleString("es-CO", { timeZone: "America/Bogota" }),
    "CÉDULA": order.customer_cedula,
    CLIENTE: order.customer_name,
    "TELÉFONO": order.customer_phone,
    CORREO: order.customer_email ?? "",
    ORIGEN: order.sales_origin_label ?? (order.order_source === "asesor" ? "Asesor" : "Catálogo virtual"),
    MODALIDAD: order.delivery_method === "domicilio" ? "Domicilio" : "Recoger en tienda",
    SEDE: order.location_name_snapshot ?? "",
    "DIRECCIÓN": order.address ?? "",
    BARRIO: order.neighborhood ?? "",
    INDICACIONES: order.address_details ?? "",
    CIUDAD: order.city ?? "",
    DEPARTAMENTO: order.department ?? "",
    SUBTOTAL: Number(order.subtotal),
    TOTAL: Number(order.total),
    ESTADO: ORDER_STATUS_LABELS[order.status],
    PAGO: PAYMENT_STATUS_LABELS[order.payment_status],
    "ÚLTIMA SOLICITUD DE ENVÍO": order.quote_sent_at
      ? new Date(order.quote_sent_at).toLocaleString("es-CO", { timeZone: "America/Bogota" })
      : "",
    "SOLICITADO POR": order.quote_sent_by_email ?? "",
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 10 }, { wch: 21 }, { wch: 18 }, { wch: 28 }, { wch: 18 }, { wch: 30 },
    { wch: 26 }, { wch: 18 }, { wch: 22 }, { wch: 38 }, { wch: 22 }, { wch: 32 },
    { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 24 }, { wch: 20 },
    { wch: 25 }, { wch: 28 },
  ];
  worksheet["!autofilter"] = { ref: worksheet["!ref"] ?? "A1:T1" };
  for (let row = 2; row <= orders.length + 1; row += 1) {
    for (const column of ["A", "C", "E"]) {
      const cell = worksheet[`${column}${row}`];
      if (cell) cell.z = "@";
    }
    for (const column of ["O", "P"]) {
      const cell = worksheet[`${column}${row}`];
      if (cell) cell.z = '"$"#,##0';
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Pedidos");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pedidos-${date}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
