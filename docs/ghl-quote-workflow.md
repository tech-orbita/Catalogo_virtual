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

## 2. Workflow: enviar cotización

Nombre sugerido: `Catálogo | Enviar cotización interactiva`.

Configuración:

1. Activa el reingreso o múltiples ejecuciones para permitir reenviar una cotización al mismo contacto.
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

## 3. Workflow: notificar al cliente

- ID: `7280e96d-7915-4dc4-9cc7-e9ee4034790c`
- Permitir reingreso: sí.
- Trigger por cambio de campo: no; la aplicación inscribe al contacto.
- Acción: enviar un mensaje normal por el canal de goGHL.ai.
- Contenido completo de la acción:

```text
{{contact.confirmacion_nuevo_pedido}}
```

El campo ya contiene saludo, número de solicitud, modalidad de entrega, sede o dirección, productos, subtotal y aviso de revisión por un asesor. No agregues otro saludo ni dupliques el contenido dentro del workflow.

## 4. Workflow: notificar a la sede

- ID: `650f1434-4e4c-4c56-a25f-0abb01bf5e4a`
- Permitir reingreso: sí.
- Trigger por cambio de campo: no; la aplicación inscribe al contacto operativo.
- Acción: enviar un mensaje normal por el canal de goGHL.ai.
- Contenido completo de la acción:

```text
{{contact.notificacion_nuevo_pedido}}
```

Para recoger, el destinatario es el contacto creado o actualizado con el WhatsApp de la sede. Para domicilio, es el contacto del centro logístico. El campo contiene cliente, teléfono, cédula, entrega, dirección separada por campos, productos, subtotal, notas y constancia de aceptación del tratamiento de datos.

## 5. Continuar el flujo de cotización

Después del envío interactivo:

1. Espera la respuesta del contacto con un tiempo límite operativo.
2. Crea una rama para la aprobación. El botón usa el ID `aprobar_cotizacion` y muestra `Aprobar`.
3. En esa rama mueve la oportunidad de `000. Productos` a `Cotización Aceptada` y continúa las acciones actuales de aprobación.
4. Crea otra rama para el ID `rechazar_cotizacion`, visible como `Rechazar`, y mueve la oportunidad a `Cotización no Aceptada` antes de continuar el flujo actual de rechazo.
5. En timeout no apruebes ni rechaces automáticamente; crea el seguimiento interno que ya utilice la cuenta.

goGHL.ai documenta que el ID del `quick_reply` alimenta la rama correspondiente. Confirma en una prueba si el filtro del workflow expone el ID o el texto visible y selecciona el valor real que aparezca en el historial.

## 6. Prueba controlada

1. Mantén el workflow en borrador mientras configuras el campo y las ramas.
2. Publica únicamente cuando las cuatro keys y los tres workflows correspondan a la misma subcuenta.
3. Usa un contacto autorizado y una cotización de prueba identificable.
4. Verifica, en orden: campo multiline actualizado, una sola ejecución del workflow, número correcto, dos botones visibles, respuesta registrada y etapa correcta.
5. Repite con el mismo contacto para comprobar el reingreso y que no se duplique el mensaje.

La marca local `cotizacion_enviada` significa que GHL aceptó la activación del workflow. La entrega real se confirma en el historial del workflow y en los registros de goGHL.ai.
