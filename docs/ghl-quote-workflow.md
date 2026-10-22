# Workflows GHL y plantillas de goGHL.ai

La aplicación no envía directamente por `/conversations/messages`: primero actualiza un custom field del contacto y después lo inscribe en el workflow correspondiente. goGHL.ai conserva el control del proveedor y del número remitente.

## 1. Custom fields del contacto

Campo multiline existente:

- Objeto: `Contact`
- Nombre: `Resumen de Cotizacion`
- Tipo: `Multi Line`
- Key completa en GHL: `contact.resumen_de_cotizacion`
- Key usada por la aplicación: `resumen_de_cotizacion`

Campo multiselección creado para la disponibilidad:

- Nombre: `Productos no disponibles`
- Tipo: `Dropdown (Multiple)`
- Key completa en GHL: `contact.productos_no_disponibles`
- Key usada por la aplicación: `productos_no_disponibles`
- Opciones: todos los productos activos del catálogo

Campos multiline que debes crear para los pedidos:

| Nombre | Tipo | Key completa en GHL | Uso |
| --- | --- | --- | --- |
| `Número de identificación` | `Single Line` | `contact.nmero_de_identificacin` | Cédula del cliente |
| `Confirmación nuevo pedido` | `Multi Line` | `contact.confirmacion_nuevo_pedido` | Mensaje completo para el cliente |
| `Notificación nuevo pedido` | `Multi Line` | `contact.notificacion_nuevo_pedido` | Mensaje completo para la sede o centro logístico |

Créelos en **Settings → Custom Fields → Contact**. La aplicación usa las keys sin el prefijo `contact.` y las mantiene versionadas en `src/lib/crm.ts`.

La aplicación usa estas keys directamente:

```text
resumen_de_cotizacion
productos_no_disponibles
```

En el editor del workflow inserta el campo desde el selector de custom values. Debe quedar como `{{contact.resumen_de_cotizacion}}`.

## 2. Workflow inicial: enviar cotización

Nombre sugerido: `Catálogo | Enviar cotización interactiva`.

Configuración:

1. Conserva la configuración actual de este workflow, incluida la espera de aprobación o rechazo.
2. No agregues un trigger por cambio de campo: la aplicación inscribe el contacto explícitamente y un segundo trigger produciría mensajes duplicados.
3. Agrega una acción normal de envío por el canal de goGHL.ai que ya usa la cuenta.
4. Conserva en esa acción el enrutamiento actual de los ocho números. La app no envía `fromNumber` ni `conversationProviderId`.
5. Pega este contenido completo en el mensaje, reemplazando el custom value si GHL generó una clave distinta:

```text
#btn|{{contact.resumen_de_cotizacion}}|undefined|undefined*undefined|quick_reply*Aprobar*aprobar_cotizacion|quick_reply*Rechazar*rechazar_cotizacion
```

El resumen completo debe ir en el campo principal (`title`). Si se coloca en `subTitle`, WhatsApp lo renderiza pequeño y con menor contraste. No dejes vacíos los parámetros opcionales: goGHL.ai exige el literal `undefined`. `quick_reply` es el tipo correcto para una decisión; el texto visible de cada botón se mantiene por debajo del límite recomendado por el proveedor.

El workflow configurado en la aplicación es:

```text
f60ba650-14ca-451d-87c4-6b3ab6eeb311
```

La variable opcional `ORBITA_CRM_QUOTE_WORKFLOW_ID` permite reemplazar ese ID sin cambiar código.

## 3. Workflow de reenvío: cotización corregida

Nombre sugerido: `Catálogo | Reenviar cotización interactiva`.

Es frecuente que el cliente no responda la primera cotización o pida cambios. El workflow inicial no admite volver a inscribir a un contacto que sigue dentro, así que los reenvíos usan este workflow aparte.

Antes de inscribir al contacto aquí, la aplicación lo **retira** del workflow inicial y de este mismo workflow (`DELETE /contacts/{id}/workflow/{workflowId}`). Si el contacto ya no estaba dentro, por ejemplo porque venció la espera, el error se ignora. Así solo queda activa la última cotización y la respuesta se procesa una sola vez.

Por eso este workflow **debe manejar la respuesta**:

1. No agregues un trigger: la aplicación inscribe el contacto explícitamente.
2. En la configuración del workflow activa **Allow re-entry** (permitir reingreso) para admitir varios reenvíos.
3. Agrega la misma acción de envío por goGHL.ai y conserva el enrutamiento actual de los ocho números.
4. Pega exactamente el mismo payload de botones:

```text
#btn|{{contact.resumen_de_cotizacion}}|undefined|undefined*undefined|quick_reply*Aprobar*aprobar_cotizacion|quick_reply*Rechazar*rechazar_cotizacion
```

5. Copia del workflow inicial la espera de respuesta y las ramas descritas en la sección 6 (`aprobar_cotizacion` → `Cotización Aceptada`, `rechazar_cotizacion` → `Cotización no Aceptada`, timeout → seguimiento interno). La forma más rápida es duplicar el workflow inicial, quitarle el trigger y publicarlo con este nombre.
6. El ID de este workflow está versionado como `ae18a7df-b54e-4e0c-998b-b713d661a762`. Si duplicas el workflow, el ID cambia: configura el nuevo ID en `ORBITA_CRM_QUOTE_RESEND_WORKFLOW_ID` en Vercel y vuelve a desplegar.

La aplicación elimina `|` de todos los datos dinámicos antes de actualizar el campo. Ese carácter es el separador del protocolo `#btn`, y si aparece dentro del resumen desplaza los parámetros y provoca el error `Invalid button format`. Los valores de la cotización van en líneas separadas por la misma razón.

## 4. Workflow: notificar al cliente

- ID: `7280e96d-7915-4dc4-9cc7-e9ee4034790c`
- Permitir reingreso: sí.
- Trigger por cambio de campo: no; la aplicación inscribe al contacto.
- Acción: enviar un mensaje normal por el canal de goGHL.ai.
- Contenido completo de la acción:

```text
{{contact.confirmacion_nuevo_pedido}}
```

El campo ya contiene un resumen compacto para que el cliente confirme nombre, teléfono, cédula, correo, modalidad y datos de entrega, productos, subtotal y notas. También indica cómo reportar un error y avisa que un asesor confirmará disponibilidad y enviará la cotización final. No agregues otro saludo ni dupliques el contenido dentro del workflow.

## 5. Workflow: notificar a la sede y a facturación

- ID: `650f1434-4e4c-4c56-a25f-0abb01bf5e4a`
- Permitir reingreso: sí.
- Trigger por cambio de campo: no; la aplicación inscribe al contacto operativo.
- Acción: enviar un mensaje normal por el canal de goGHL.ai.
- Contenido completo de la acción:

```text
{{contact.notificacion_nuevo_pedido}}
```

Para recoger, el destinatario es el contacto creado o actualizado con el WhatsApp de la sede. Para domicilio, es el contacto del centro logístico. El campo contiene cliente, teléfono, cédula, entrega, dirección separada por campos, productos, subtotal, notas y constancia de aceptación del tratamiento de datos.

Cuando una cotización pasa a `Cotización aceptada`, la aplicación reutiliza este workflow para avisar al contacto definido por:

```text
ORBITA_BILLING_WHATSAPP_NUMBER=
ORBITA_BILLING_CONTACT_NAME=Facturación
```

## 6. Continuar el flujo de cotización

Después del envío interactivo:

1. Espera la respuesta del contacto con un tiempo límite operativo.
2. Crea una rama para la aprobación. El botón usa el ID `aprobar_cotizacion` y muestra `Aprobar`.
3. En esa rama mueve la oportunidad de `000. Productos` a `Cotización Aceptada` y continúa las acciones actuales de aprobación.
4. Crea otra rama para el ID `rechazar_cotizacion`, visible como `Rechazar`, y mueve la oportunidad a `Cotización no Aceptada` antes de continuar el flujo actual de rechazo.
5. En timeout no apruebes ni rechaces automáticamente; crea el seguimiento interno que ya utilice la cuenta.

goGHL.ai documenta que el ID del `quick_reply` alimenta la rama correspondiente. Confirma en una prueba si el filtro del workflow expone el ID o el texto visible y selecciona el valor real que aparezca en el historial.

## 7. Prueba controlada

1. Mantén el workflow en borrador mientras configuras el campo y las ramas.
2. Publica el workflow de reenvío y configura su ID en `ORBITA_CRM_QUOTE_RESEND_WORKFLOW_ID`.
3. Usa un contacto autorizado y una cotización de prueba identificable.
4. Verifica, en orden: campo multiline actualizado, una sola ejecución del workflow, número correcto, dos botones visibles, respuesta registrada y etapa correcta.
5. Edita la misma cotización y solicita el reenvío. Verifica que el contacto salga del workflow inicial, que entre una sola vez al de reenvío y que el mensaje muestre los valores corregidos sin `|`.
6. Pulsa un botón del mensaje reenviado y confirma que el workflow de reenvío mueve la oportunidad a la etapa correcta.

La marca local `cotizacion_enviada` significa que GHL aceptó la activación del workflow. La entrega real se confirma en el historial del workflow y en los registros de goGHL.ai.
