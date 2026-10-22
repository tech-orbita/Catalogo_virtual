const INTERACTIVE_PROTOCOL_SEPARATOR = "|";

/**
 * goGHL usa `|` como separador del payload #btn. Ningún valor dinámico puede
 * conservar ese carácter porque desplaza los campos y termina mostrando
 * "Invalid button format".
 */
export function sanitizeInteractiveMessageText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replaceAll(INTERACTIVE_PROTOCOL_SEPARATOR, "·")
    .trim();
}
