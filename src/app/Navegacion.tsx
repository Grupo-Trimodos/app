"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { enlacesMenu, type Enlace } from "@/lib/navegacion";
import Icono from "./Icono";

export default function Navegacion({ areas, inicio = "Inicio" }: { areas: Enlace[]; inicio?: string }) {
  const ruta = usePathname();
  return <nav className="shell-nav" aria-label="Navegación principal">
    {enlacesMenu(areas, inicio).map((a) => {
      const activo = a.ruta === "/" ? ruta === "/" : ruta === a.ruta || ruta.startsWith(a.ruta.replace(/\/$/, "") + "/");
      const contenido = <><Icono nombre={a.icono} size={21} /><span>{a.nombre}</span></>;
      const props = { className: `shell-nav-link${activo ? " activo" : ""}`, "aria-current": activo ? "page" as const : undefined };
      // DECA es una PWA independiente y necesita una navegación completa.
      return a.id === "deca" ? <a key={a.id} href={a.ruta} {...props}>{contenido}</a>
        : <Link key={a.id} href={a.ruta} {...props}>{contenido}</Link>;
    })}
  </nav>;
}

/** En la app del móvil (chóferes y operarios) no hay menú: fuera del inicio, un botón grande para volver. */
export function VolverAlInicio() {
  const ruta = usePathname();
  if (ruta === "/") return <span className="campo-hueco" />;
  return <Link className="campo-volver" href="/"><Icono nombre="flecha" size={18} /><span>Inicio</span></Link>;
}
