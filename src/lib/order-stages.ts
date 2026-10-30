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
    description:
      "Avisa al grupo de domicilios o a la sede. Es obligatorio antes de marcarlo como listo.",
  },
  cotizacion_aceptada: {
    status: "pedido_listo",
    shortLabel: "Marcar listo",
    label: "Marcar pedido listo",
    description: "Indica que el pedido ya está preparado.",
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

/** Indica si el pedido ya pasó por cotización aceptada (y se avisó a quien lo prepara). */
export function isAcceptedOrLater(status: OrderStatus) {
  return status === "cotizacion_aceptada" || POST_ACCEPTANCE_STATUSES.has(status);
}

/**
 * Nadie puede saltar a pedido listo, enviado o entregado sin marcar antes la
 * cotización aceptada: ese paso es el que avisa al grupo de domicilios o a la sede.
 */
export function canMoveToStatus(from: OrderStatus, to: OrderStatus) {
  return !POST_ACCEPTANCE_STATUSES.has(to) || isAcceptedOrLater(from);
}

export const ACCEPTANCE_REQUIRED_MESSAGE =
  "Primero marca la cotización como aceptada: ese paso avisa al grupo de domicilios o a la sede.";
