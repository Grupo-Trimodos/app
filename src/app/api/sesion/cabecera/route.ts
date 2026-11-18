import { isValidElement, type ReactNode } from "react";
import { NextResponse } from "next/server";
import { trazos } from "@/app/Icono";
import { CONTEXTO, enlacesMenu, iniciales, pestanasCampo } from "@/lib/navegacion";
import { misPendientes } from "@/lib/pendientes";
import { AREAS } from "@/lib/permisos";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigurado } from "@/lib/supabase/env";
import { usuarioActual } from "@/lib/usuario";

/**
 * Lo que hace falta para pintar la cabecera y el menú de la app fuera de las páginas de Next: lo usa la PWA de DECA
 * (public/deca/app.js) para llevar la misma cabecera que el resto. Solo datos de quien pregunta: su nombre, su pantalla,
 * los enlaces de SU menú y cuántos pendientes tiene. Los iconos van como dibujo SVG, sacados de src/app/Icono.tsx.
 */
const sinCache = { headers: { "Cache-Control": "no-store" } };

/** El interior de un icono (path, circle, rect) como texto SVG. Solo etiquetas y atributos sencillos, los de Icono.tsx. */
function dibujo(nodo: ReactNode): string {
  if (Array.isArray(nodo)) return nodo.map(dibujo).join("");
  if (!isValidElement(nodo)) return "";
  const { children, ...attrs } = nodo.props as { children?: ReactNode } & Record<string, string | number>;
  if (typeof nodo.type !== "string") return dibujo(children);   // fragmento
  const texto = Object.entries(attrs).map(([k, v]) => ` ${k}="${String(v).replace(/[^\w .,-]/g, "")}"`).join("");
  return `<${nodo.type}${texto}/>`;
}
const icono = (nombre: string) => dibujo(trazos[nombre] ?? trazos.documento);
const fijos = () => ({ campana: icono("campana"), salir: icono("salir"), flecha: icono("flecha"), actividad: icono("actividad"), menu: icono("menu") });
const pestanas = (enMenu: (area: string) => boolean) => pestanasCampo(enMenu).map((p) => ({ ...p, icono: icono(p.icono) }));

export async function GET() {
  if (!supabaseConfigurado()) {
    // Solo en local y sin Supabase (pruebas de DECA): la cabecera de un chófer de prueba.
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json({ nombre: "Usuario de prueba", iniciales: "UP", pantalla: "campo", contexto: CONTEXTO.campo,
        etiqueta: "", enlaces: [], pestanas: pestanas((a) => ["fichaje", "ausencias"].includes(a)), pendientes: 0, iconos: fijos() }, sinCache);
    }
    return NextResponse.json({ error: "La app no está configurada." }, { status: 503, ...sinCache });
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return NextResponse.json({ error: "Tienes que iniciar sesión." }, { status: 401, ...sinCache });

  const [{ perfil, enMenu, pantalla }, { total }] = await Promise.all([usuarioActual(), misPendientes()]);
  const nombre = perfil?.nombre || perfil?.codigo || "";
  const areas = pantalla === "campo" ? [] : AREAS.filter((a) => enMenu(a.id)).map(({ id, nombre, ruta }) => ({ id, nombre, ruta }));
  const enlaces = pantalla === "campo" ? []
    : enlacesMenu(areas, pantalla === "direccion" ? "Cuadro de mando" : "Inicio").map((e) => ({ ...e, icono: icono(e.icono) }));
  return NextResponse.json({
    nombre, iniciales: iniciales(nombre), pantalla: pantalla ?? "oficina", contexto: CONTEXTO[pantalla ?? "oficina"],
    pestanas: pantalla === "campo" ? pestanas(enMenu) : [],
    etiqueta: pantalla === "direccion" ? "DIRECCIÓN" : "ESPACIO DE TRABAJO", enlaces, pendientes: total, iconos: fijos(),
  }, sinCache);
}
