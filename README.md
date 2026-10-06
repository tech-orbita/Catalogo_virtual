# Catálogo Virtual

Aplicación Next.js con dos experiencias conectadas a la misma base de datos:

- Catálogo público mobile-first en `/`.
- Dashboard operativo protegido en `/admin`, preparado para embeberse como iframe en el panel de Órbita IA.

El panel permite administrar portada, categorías, productos, sedes y pedidos. Toda solicitud nueva entra en la etapa `Pendiente por cotizar`; un asesor puede crear pedidos manuales, revisar cada solicitud y enviar una cotización editable por WhatsApp desde Órbita IA. Supabase gestiona autenticación y datos; las imágenes pueden almacenarse en Supabase Storage o Cloudflare R2 según el flujo utilizado.

## Desarrollo local

1. Copia `.env.local.example` a `.env.local` y completa las variables.
2. Instala dependencias con `npm.cmd install`.
3. Ejecuta `npm.cmd run dev`.
4. Abre `http://localhost:3000` para el catálogo o `http://localhost:3000/admin` para el panel.

## Base de datos

Las migraciones están en `supabase/migrations`. La migración `0006_orders_quotes_ghl.sql` retira las columnas antiguas de existencias y habilita pedidos manuales, cotizaciones y trazabilidad del CRM. No ejecutes migraciones contra un proyecto remoto sin revisar el entorno y el alcance.

Para crear el primer usuario administrador usa Supabase Authentication o el helper `scripts/create-admin-user.mjs` con variables server-side temporales.

## CRM de Órbita IA

La integración server-side usa `ORBITA_CRM_API_KEY` (Private Integration Token) y `ORBITA_CRM_LOCATION_ID`. Los datos del cliente se crean o actualizan al guardar el pedido y el resumen completo queda como nota del contacto. Las confirmaciones, cotizaciones y alertas operativas se disparan añadiendo contactos a workflows internos de GHL; la aplicación no envía mensajes directamente por la API de conversaciones.

El paso a paso de publicación, iframe, sesión, variables y prueba controlada está en [docs/orbita-iframe-setup.md](docs/orbita-iframe-setup.md).
