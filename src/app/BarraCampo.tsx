"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import Icono from "./Icono";

export type Pestana = { href: string; texto: string; icono: string };

/**
 * App del móvil (chóferes y operarios): barra fija abajo con sus pestañas (las decide Cabecera.tsx por permisos).
 * También quita de la dirección el «?ok=» / «?error=» de la última acción: el mensaje se ve una vez y no reaparece al
 * recargar la página.
 */
export default function BarraCampo({ pestanas }: { pestanas: Pestana[] }) {
  const ruta = usePathname();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("ok") && !url.searchParams.has("error")) return;
    url.searchParams.delete("ok");
    url.searchParams.delete("error");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [ruta]);
  if (pestanas.length < 2) return null;
  return <nav className="campo-barra" aria-label="Secciones">
    {pestanas.map((p) => {
      const activa = p.href === "/" ? ruta === "/" : ruta === p.href || ruta.startsWith(`${p.href}/`);
      return <Link key={p.href} href={p.href} className={activa ? "activa" : undefined} aria-current={activa ? "page" : undefined}>
        <Icono nombre={p.icono} size={26} /><span>{p.texto}</span>
      </Link>;
    })}
  </nav>;
}
