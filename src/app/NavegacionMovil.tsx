"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { enlacesMenu, type Enlace } from "@/lib/navegacion";
import Icono from "./Icono";

/** Cuatro destinos fijos y «Más». La lista recibida ya está filtrada por los permisos de la persona. */
export default function NavegacionMovil({ areas, inicio }: { areas: Enlace[]; inicio: string }) {
  const ruta = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  const enlaces = enlacesMenu(areas, inicio);
  const directos = enlaces.length > 5 ? enlaces.slice(0, 4) : enlaces;
  const otros = enlaces.length > 5 ? enlaces.slice(4) : [];
  const activo = (href: string) => href === "/" ? ruta === "/" : ruta === href || ruta.startsWith(`${href.replace(/\/$/, "")}/`);
  useEffect(() => { panel.current?.hidePopover(); }, [ruta]);
  const enlace = (e: (typeof enlaces)[number], corto = false) => {
    const props = { className: activo(e.ruta) ? "activo" : undefined, "aria-current": activo(e.ruta) ? "page" as const : undefined,
      onClick: () => panel.current?.hidePopover(), title: e.nombre };
    const contenido = <><Icono nombre={e.icono} size={24} /><span>{corto ? e.nombreMovil : e.nombre}</span></>;
    return e.id === "deca" ? <a key={e.id} href={e.ruta} {...props}>{contenido}</a>
      : <Link key={e.id} href={e.ruta} {...props}>{contenido}</Link>;
  };
  return <>
    <nav className="shell-mobile-nav" aria-label="Secciones">
      {directos.map((e) => enlace(e, true))}
      {otros.length > 0 && <button type="button" popoverTarget="secciones-movil" className={otros.some((e) => activo(e.ruta)) ? "activo" : undefined}>
        <Icono nombre="menu" size={24} /><span>Más</span>
      </button>}
    </nav>
    {otros.length > 0 && <div ref={panel} id="secciones-movil" popover="auto" className="shell-mobile-panel" aria-labelledby="secciones-movil-titulo">
      <header><h2 id="secciones-movil-titulo">Más secciones</h2><button type="button" popoverTarget="secciones-movil" popoverTargetAction="hide">Cerrar</button></header>
      <nav aria-label="Más secciones">{otros.map((e) => enlace(e))}</nav>
    </div>}
  </>;
}
