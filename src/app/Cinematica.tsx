"use client";
import { useEffect } from "react";

/** Carga la cinemática de entrada (public/deca/cinematica.js, la misma que DECA). Ella decide si toca: no la primera vez,
 *  sí al volver a abrir la app con la sesión recordada, una vez por sesión del navegador. */
export default function Cinematica() {
  useEffect(() => {
    const w = window as unknown as { TrimodosCinematica?: { iniciar: () => void } };
    if (w.TrimodosCinematica) { w.TrimodosCinematica.iniciar(); return; }
    if (document.getElementById("cinematica-js")) return;
    const s = document.createElement("script");
    s.id = "cinematica-js";
    s.src = "/deca/cinematica.js";
    s.onerror = () => document.documentElement.classList.remove("cine-pendiente");
    document.body.append(s);
  }, []);
  return null;
}
