"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const noopSubscribe = () => () => {};
const useIsClient = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );

/**
 * Los contenedores de página usan la animación `admin-enter`, que deja un
 * `transform` permanente y convierte a ese div en bloque contenedor de sus
 * descendientes `position: fixed`. Un overlay renderizado ahí dentro se recorta
 * a la altura del contenido en vez de ocupar el viewport, así que los modales
 * se montan en <body>.
 */
export function ModalPortal({ children }: { children: React.ReactNode }) {
  const isClient = useIsClient();

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!isClient) return null;
  return createPortal(<div className="admin-shell">{children}</div>, document.body);
}
