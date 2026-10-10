# Publicación del catálogo e integración con el CRM de Órbita IA

La misma aplicación expone dos entradas:

- Dashboard privado: `https://TU-DOMINIO/admin`
- Catálogo público: `https://TU-DOMINIO/`

## 1. Publicar la aplicación

Despliega el proyecto en un dominio HTTPS. En el proveedor de hosting configura las variables que aparecen en `.env.local.example` y agrega:

```env
ORBITA_ALLOWED_FRAME_ANCESTORS=https://TU-DOMINIO-WHITELABEL
ORBITA_STRICT_FRAME_ANCESTORS=false
```

Usa orígenes, no rutas: `https://dominio.com` es válido; `https://dominio.com/ruta` no lo es. Con `ORBITA_STRICT_FRAME_ANCESTORS=true` la cabecera solo autoriza los orígenes que declares, sin dominios del proveedor. Después de cambiar esta variable vuelve a desplegar, porque `next.config.ts` construye la política de iframe al iniciar la aplicación.

## 2. Preparar el acceso administrativo

El login público de registro fue retirado. Crea cada administrador desde Supabase Authentication o con el script local `scripts/create-admin-user.mjs`. No compartas la service role key con el navegador ni la guardes en el repositorio.

La sesión del panel usa cookies `SameSite=None; Secure; Partitioned` en producción. Esto permite conservar la sesión dentro del iframe del CRM y la separa por sitio superior en navegadores compatibles. La sesión se renueva con Supabase mientras siga siendo válida y solo se elimina al cerrar sesión o borrar los datos del navegador.

## 3. Agregar el iframe en el CRM

Debes entrar como administrador de agencia:

1. Abre `Agency view`.
2. Entra a `Settings` y luego a `Custom Menu Links`.
3. Selecciona `Create New`.
4. Usa un título como `Catálogo Virtual` y elige un icono de productos o tienda.
5. En `URL` pega `https://TU-DOMINIO/admin`.
6. En el modo de apertura selecciona `Open in an Embedded Page (iFrame)`.
7. En la visibilidad lateral activa `Sub-Account sidebar`.
8. Selecciona únicamente la subcuenta que administrará este catálogo.
9. En roles elige `Admin` si solo los administradores deben editar productos.
10. Deja cámara y micrófono desactivados y guarda.

La primera apertura sin sesión muestra el login. Después de autenticar, las siguientes aperturas en la misma subcuenta y navegador entran al dashboard mientras el refresh token siga vigente.

## 4. Probar antes de entregar

1. Abre el enlace desde el menú de la subcuenta, no solo en una pestaña normal.
2. Confirma que aparece el login y que las credenciales llevan a `/admin`.
3. Cierra el menú y vuelve a abrirlo; el dashboard debe conservar la sesión.
4. Edita un producto de prueba y confirma que el cambio aparece en `https://TU-DOMINIO/`.
5. Prueba el catálogo público en un móvil y completa un checkout de prueba controlado.

Si el navegador bloquea todas las cookies de terceros, permite cookies para el dominio del catálogo o abre `/admin` en una pestaña nueva. No envíes la URL `/admin` a clientes; comparte únicamente la raíz pública.

### Si aparece "vercel.com refused to connect"

Ese mensaje indica que Vercel está redirigiendo el iframe a su propia pantalla de autenticación. La pantalla de Vercel no admite ser cargada dentro de un iframe.

1. En Vercel abre el proyecto y entra a `Settings > Deployment Protection`.
2. En `Vercel Authentication`, selecciona `None` para la URL que vas a embeber y guarda.
3. Usa preferiblemente el dominio de producción listado en `Settings > Domains`; evita la URL de rama que contiene `git-main`.
4. Vuelve a desplegar después de cambiar `ORBITA_ALLOWED_FRAME_ANCESTORS`.
5. Comprueba que la URL ya no redirige a `vercel.com/sso-api` antes de pegar `https://TU-DOMINIO/admin` en el CRM.

Un enlace compartible de preview no es apropiado como URL permanente del iframe: depende de cookies de Vercel y puede romperse en sesiones o navegadores distintos. El login que debe proteger el panel es `/admin/login`, servido por esta aplicación, no el login de Vercel.

## 5. MCP de Supabase para este proyecto

El servidor quedó declarado en `.codex/config.toml` con el nombre `supabase_catalogo_virtual` y limitado al proyecto `xoztabrfvxandlvjkbhs`.

Desde una terminal abierta en esta carpeta:

```powershell
codex mcp login supabase_catalogo_virtual --oauth-client-registration dcr
codex mcp list
```

La autenticación abre OAuth en el navegador. No requiere guardar un PAT en el repositorio. Los scopes compatibles con Supabase están declarados en la configuración y las herramientas de escritura quedan configuradas para pedir aprobación.

## 6. Sincronización de contactos y cotizaciones mediante workflow

El checkout y la creación manual de pedidos sincronizan el cliente con la subcuenta del CRM al guardar la solicitud. El pedido completo también se agrega como nota del contacto. El botón `Enviar cotización` actualiza un campo multiline del contacto y lo inscribe en un workflow; la aplicación no crea el mensaje ni elige proveedor o número remitente.

Configura estas variables en el entorno del servidor:

```env
ORBITA_CRM_API_KEY=pit-REEMPLAZAR
ORBITA_CRM_LOCATION_ID=REEMPLAZAR_ID_SUBCUENTA
ORBITA_CRM_DEFAULT_PHONE_COUNTRY_CODE=57
ORBITA_CRM_CONTACT_COUNTRY=CO
ORBITA_LOGISTICS_WHATSAPP_NUMBER=3508811341
```

Los IDs de los workflows y las keys de los campos de mensaje están versionados
en `src/lib/crm.ts` para que el despliegue no dependa de variables opcionales:

- enviar cotización: `f60ba650-14ca-451d-87c4-6b3ab6eeb311`;
- notificar a la sede: `650f1434-4e4c-4c56-a25f-0abb01bf5e4a`;
- notificar al cliente: `7280e96d-7915-4dc4-9cc7-e9ee4034790c`.

El Private Integration Token debe pertenecer a la subcuenta y tener `contacts.write`, además de los permisos de oportunidades que ya usa el panel. Ya no necesita `conversations/message.write` para cotizar. Si deseas guardar la cédula como un campo visible independiente, crea el custom field en el CRM y agrega su id como `ORBITA_CRM_CEDULA_CUSTOM_FIELD_ID`; de todas formas, la cédula y el resto del pedido quedan incluidos en la nota.

### Workflow y canal de salida

La app ejecuta solamente estas operaciones:

1. Actualiza por key el resumen y la selección de productos no disponibles en el contacto.
2. Inscribe el contacto en el workflow de cotización versionado en `src/lib/crm.ts`.
3. El workflow envía un mensaje normal por goGHL.ai cuyo contenido empieza por `#btn`; el proveedor lo transforma en un mensaje interactivo.

El número remitente, el proveedor y los botones no se envían por la API de conversaciones. Si las keys versionadas no existen en la subcuenta o el workflow no está publicado, el pedido no cambia a cotización enviada.

Al crear un pedido desde el catálogo, la app guarda el resumen completo como nota del contacto, actualiza `contact.confirmacion_nuevo_pedido` y activa el workflow publicado de confirmación del cliente. Para recoger, toma `store_locations.whatsapp_number`, crea o actualiza el contacto operativo de la sede, actualiza `contact.notificacion_nuevo_pedido` y vuelve a añadirlo al workflow publicado de notificación. Para domicilio no acepta sede desde el navegador: usa el contacto del centro logístico configurado en `ORBITA_LOGISTICS_WHATSAPP_NUMBER`. Ambos workflows deben permitir reingreso para recibir pedidos sucesivos.

La configuración exacta del workflow, la sintaxis de goGHL.ai y las ramas de aprobación/rechazo está en `docs/ghl-quote-workflow.md`.

Antes de operar en producción, aplica también `supabase/migrations/20261006172937_order_quote_builder.sql` y `supabase/migrations/20261006180732_allow_delivery_orders_without_store_location.sql`, vuelve a desplegar las variables y prueba con un contacto autorizado. Una activación exitosa confirma que GHL aceptó el contacto en el workflow; no confirma que goGHL.ai haya entregado el mensaje.
