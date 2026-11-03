import type { OrderStatus } from "@/lib/types";

export interface NextOrderStage {
  status: OrderStatus;
  /** Texto corto para el botón de la lista de pedidos. */
  shortLabel: string;
  label: string;
  description: string;
}

export const NEXT_ORDER_STAGE: Partial<Record<OrderStatus, NextOrderStage>> = {
  cotizacion_enviada: {
    status: "cotizacion_aceptada",
    shortLabel: "Confirmar",
    label: "Marcar cotización aceptada",
    description: "Registra que el cliente aceptó la cotización. Todavía no avisa a nadie.",
  },
  cotizacion_aceptada: {
    status: "pedido_listo",
    shortLabel: "Enviar a preparación",
    label: "Enviar a preparación",
    description:
      "Envía el pedido al grupo de domicilios o a la sede para que lo preparen y lo pasa a pedido listo.",
  },
  pedido_listo: {
    status: "pedido_enviado",
    shortLabel: "Despachar",
    label: "Marcar como enviado",
    description: "Informa que el pedido ya salió de la sede.",
  },
  pedido_enviado: {
    status: "pedido_entregado",
    shortLabel: "Entregado",
    label: "Marcar como entregado",
    description: "Finaliza el seguimiento cuando llegue al cliente.",
  },
};

/** Etapas que solo se alcanzan después de aceptar la cotización. */
const POST_ACCEPTANCE_STATUSES = new Set<OrderStatus>([
  "pedido_listo",
  "pedido_enviado",
  "pedido_entregado",
]);

/** Indica si el pedido ya pasó por cotización aceptada. */
export function isAcceptedOrLater(status: OrderStatus) {
  return status === "cotizacion_aceptada" || POST_ACCEPTANCE_STATUSES.has(status);
}

/**
 * Indica si el cambio envía el pedido a preparación: sale de cotización aceptada
 * hacia pedido listo, enviado o entregado. Ese paso, hecho a mano por el asesor
 * desde el dashboard, es el que avisa al grupo de domicilios o a la sede.
 */
export function sendsToPreparation(from: OrderStatus, to: OrderStatus) {
  return from === "cotizacion_aceptada" && POST_ACCEPTANCE_STATUSES.has(to);
}

/**
 * Nadie puede saltar a pedido listo, enviado o entregado sin marcar antes la
 * cotización aceptada: así todo pedido pasa por el envío a preparación.
 */
export function canMoveToStatus(from: OrderStatus, to: OrderStatus) {
  return !POST_ACCEPTANCE_STATUSES.has(to) || isAcceptedOrLater(from);
}

export const ACCEPTANCE_REQUIRED_MESSAGE =
  "Primero marca la cotización como aceptada y luego envía el pedido a preparación.";
