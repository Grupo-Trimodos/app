"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Barra fina arriba en cuanto se pulsa un enlace o un botón de la app. Cada página se prepara en el servidor con los
 * datos del momento (medio segundo; más con poca cobertura) y, sin esto, mientras tanto no se ve que pase nada.
 * Termina al cambiar de página o lo que se ve. Mientras, el formulario enviado no acepta un segundo toque.
 */
export default function BarraCarga() {
  const ruta = usePathname();
  const busqueda = useSearchParams().toString();
  const [fase, setFase] = useState<"" | "cargando" | "fin">("");
  const terminar = useRef(() => {});

  useEffect(() => {
    let reloj: number | undefined;
    let observador: MutationObserver | null = null;
    const fin = () => {
      observador?.disconnect();
      observador = null;
      clearTimeout(reloj);
      document.querySelectorAll("form.enviando").forEach((f) => f.classList.remove("enviando"));
      setFase((f) => (f === "cargando" ? "fin" : f));
    };
    const empezar = () => {
      setFase("cargando");
      clearTimeout(reloj);
      reloj = window.setTimeout(fin, 10000);   // si nada avisa, no se queda a medias
      // Una acción que vuelve a la misma dirección (aprobar dos solicitudes seguidas) no cambia la ruta: también se
      // termina cuando cambia lo que se ve.
      observador?.disconnect();
      observador = new MutationObserver(fin);
      observador.observe(document.body, { childList: true, subtree: true, characterData: true });
    };
    const alPulsar = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a?.href || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const destino = new URL(a.href, location.href);
      // Fuera de la app, la misma página o un ancla dentro de ella: no hay nada que esperar.
      if (destino.origin !== location.origin || (destino.pathname === location.pathname && destino.search === location.search)) return;
      empezar();
    };
    const alEnviar = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (form.target && form.target !== "_self") return;
      form.classList.add("enviando");
      empezar();
    };
    // Al volver atrás desde DECA el navegador puede enseñar la página guardada tal cual, con la barra a medias.
    const alVolver = (e: PageTransitionEvent) => { if (e.persisted) fin(); };
    // La app apunta cada página que llega en el historial, aunque la dirección no cambie (los navegadores actuales lo avisan).
    const historial = (window as { navigation?: EventTarget }).navigation;
    // En captura: antes de que el enlace o el formulario lo gestionen (y cancelen) por su cuenta.
    document.addEventListener("click", alPulsar, true);
    document.addEventListener("submit", alEnviar, true);
    window.addEventListener("pageshow", alVolver);
    historial?.addEventListener("currententrychange", fin);
    terminar.current = fin;
    return () => {
      document.removeEventListener("click", alPulsar, true);
      document.removeEventListener("submit", alEnviar, true);
      window.removeEventListener("pageshow", alVolver);
      historial?.removeEventListener("currententrychange", fin);
      fin();
    };
  }, []);

  // Página nueva: se acabó la espera.
  useEffect(() => { terminar.current(); }, [ruta, busqueda]);

  // Se desvanece y queda lista para la siguiente.
  useEffect(() => {
    if (fase !== "fin") return;
    const t = setTimeout(() => setFase(""), 400);
    return () => clearTimeout(t);
  }, [fase]);

  return <div className={`barra-carga ${fase}`} aria-hidden="true" />;
}
