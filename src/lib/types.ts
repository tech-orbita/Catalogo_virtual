export type DeliveryMethod = "domicilio" | "recoger";

export type OrderStatus =
  | "pedido_realizado"
  | "cotizacion_enviada"
  | "cotizacion_aceptada"
  | "cotizacion_no_aceptada"
  | "no_hubo_producto"
  | "pedido_listo"
  | "pedido_enviado"
  | "pedido_entregado";

export type PaymentStatus = "pendiente" | "pagado";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pedido_realizado: "Pedido realizado",
  cotizacion_enviada: "Cotización enviada",
  cotizacion_aceptada: "Cotización aceptada",
  cotizacion_no_aceptada: "Cotización no aceptada",
  no_hubo_producto: "No hubo producto",
  pedido_listo: "Pedido listo",
  pedido_enviado: "Pedido enviado",
  pedido_entregado: "Pedido entregado",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pendiente: "Pendiente de pago",
  pagado: "Pagado",
};

export interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  image_url: string | null;
  sort_order: number;
  created_at: string;
}

export interface CategoryWithChildren extends Category {
  children: Category[];
  product_count?: number;
  preview_images?: string[];
}

export interface ProductVariant {
  id: string;
  product_id: string;
  variant_name: string;
  option_value: string;
  price_override: number | null;
  sku: string | null;
  sort_order: number;
}

export interface ProductImage {
  id: string;
  product_id: string;
  url: string;
  sort_order: number;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  description: string | null;
  price: number;
  compare_at_price: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductWithRelations extends Product {
  images: ProductImage[];
  variants: ProductVariant[];
  categories: Category[];
}

export interface StoreSettings {
  id: true;
  store_name: string;
  logo_url: string | null;
  banner_url: string | null;
  description: string | null;
  whatsapp_number: string | null;
  currency: string;
  updated_at: string;
}

export interface StoreLocation {
  id: string;
  name: string;
  address: string;
  city: string | null;
  department: string | null;
  whatsapp_number: string;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  order_number: number;
  customer_name: string;
  customer_phone: string;
  customer_cedula: string;
  customer_email?: string | null;
  delivery_method: DeliveryMethod;
  address: string | null;
  address_details: string | null;
  city: string | null;
  department: string | null;
  notes: string | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
  subtotal: number;
  total: number;
  location_id?: string | null;
  location_name_snapshot?: string | null;
  location_address_snapshot?: string | null;
  location_whatsapp_snapshot?: string | null;
  order_source?: "catalogo" | "asesor";
  created_by_email?: string | null;
  ghl_contact_id?: string | null;
  ghl_sync_status?: "pendiente" | "sin_configurar" | "sincronizado" | "error";
  ghl_sync_error?: string | null;
  ghl_synced_at?: string | null;
  quote_message?: string | null;
  quote_sent_at?: string | null;
  quote_sent_by_email?: string | null;
  ghl_message_id?: string | null;
  ghl_conversation_id?: string | null;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name_snapshot: string;
  variant_label_snapshot: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

// ---- Carrito (cliente) ----
export interface CartItem {
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
  slug: string;
}
