# Workflow GHL: cotización interactiva del catálogo

Este flujo reemplaza el envío directo por `/conversations/messages`. La aplicación solo guarda el resumen en el contacto y activa el workflow. goGHL.ai conserva el control del proveedor y de los ocho números.

## 1. Campos del contacto

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

Configura las keys, no los IDs:

```env
ORBITA_CRM_QUOTE_CUSTOM_FIELD_KEY=resumen_de_cotizacion
ORBITA_CRM_UNAVAILABLE_PRODUCTS_CUSTOM_FIELD_KEY=productos_no_disponibles
```

En el editor del workflow inserta el campo desde el selector de custom values. Debe quedar como `{{contact.resumen_de_cotizacion}}`.

## 2. Crear el workflow

Nombre sugerido: `Catálogo | Enviar cotización interactiva`.

Configuración:

1. Activa el reingreso o múltiples ejecuciones para permitir reenviar una cotización al mismo contacto.
2. No agregues un trigger por cambio de campo: la aplicación inscribe el contacto explícitamente y un segundo trigger produciría mensajes duplicados.
3. Agrega una acción normal de envío por el canal de goGHL.ai que ya usa la cuenta.
4. Conserva en esa acción el enrutamiento actual de los ocho números. La app no envía `fromNumber` ni `conversationProviderId`.
5. Pega este contenido completo en el mensaje, reemplazando el custom value si GHL generó una clave distinta:

```text
#btn|Tu cotización está lista|{{contact.resumen_de_cotizacion}}|undefined*undefined|quick_reply*Aprobar*aprobar_cotizacion|quick_reply*Rechazar*rechazar_cotizacion
```

No dejes vacíos los parámetros opcionales: goGHL.ai exige el literal `undefined`. `quick_reply` es el tipo correcto para una decisión; el texto visible de cada botón se mantiene por debajo del límite recomendado por el proveedor.

Después de guardar el workflow copia su ID en:

```env
ORBITA_CRM_QUOTE_WORKFLOW_ID=REEMPLAZAR_ID_WORKFLOW
```

## 3. Continuar el flujo actual

Después del envío interactivo:

1. Espera la respuesta del contacto con un tiempo límite operativo.
2. Crea una rama para la aprobación. El botón usa el ID `aprobar_cotizacion` y muestra `Aprobar`.
3. En esa rama mueve la oportunidad de `000. Productos` a `Cotización Aceptada` y continúa las acciones actuales de aprobación.
4. Crea otra rama para el ID `rechazar_cotizacion`, visible como `Rechazar`, y mueve la oportunidad a `Cotización no Aceptada` antes de continuar el flujo actual de rechazo.
5. En timeout no apruebes ni rechaces automáticamente; crea el seguimiento interno que ya utilice la cuenta.

goGHL.ai documenta que el ID del `quick_reply` alimenta la rama correspondiente. Confirma en una prueba si el filtro del workflow expone el ID o el texto visible y selecciona el valor real que aparezca en el historial.

## 4. Prueba controlada

1. Mantén el workflow en borrador mientras configuras el campo y las ramas.
2. Publica únicamente cuando las keys y el workflow correspondan a la misma subcuenta.
3. Usa un contacto autorizado y una cotización de prueba identificable.
4. Verifica, en orden: campo multiline actualizado, una sola ejecución del workflow, número correcto, dos botones visibles, respuesta registrada y etapa correcta.
5. Repite con el mismo contacto para comprobar el reingreso y que no se duplique el mensaje.

La marca local `cotizacion_enviada` significa que GHL aceptó la activación del workflow. La entrega real se confirma en el historial del workflow y en los registros de goGHL.ai.
