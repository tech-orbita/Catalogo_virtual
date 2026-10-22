import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeInteractiveMessageText } from "../src/lib/interactive-message.ts";

test("elimina separadores reservados del texto interactivo", () => {
  const value = sanitizeInteractiveMessageText("Productos: $ 10.000 | Total: $ 12.000");
  assert.equal(value, "Productos: $ 10.000 · Total: $ 12.000");
  assert.equal(value.includes("|"), false);
});

test("normaliza saltos y caracteres de control", () => {
  assert.equal(sanitizeInteractiveMessageText(" Hola\r\ncliente\u0007 "), "Hola\ncliente");
});
