"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { llamarPythonDetalle } from "@/lib/python";
import { conPermiso } from "@/lib/usuario";
import { elegible, type RespuestaVinculos } from "./tipos";

const volver = (msg: string, tipo: "ok" | "error" = "ok"): never => redirect(`/equipo/odoo?${tipo}=${encodeURIComponent(msg)}`);
const MENSAJES_BASE = ["22023", "23505", "42501"];   // los avisos de la base de datos ya están escritos para la pantalla

/** «Son la misma persona». Solo se acepta una ficha que Odoo propone ahora para esa persona (activa, de las empresas
 *  configuradas y libre); la base de datos comprueba además que esté en tus centros y anota quién lo confirma. */
export async function confirmarVinculo(form: FormData) {
  const { supabase } = await conPermiso("personas.vincular");
  const persona = String(form.get("persona") ?? "");
  const empleado = Number(form.get("empleado"));
  const textoConductor = String(form.get("conductor") ?? "");
  const conductor = textoConductor ? Number(textoConductor) : null;
  if (!persona || !Number.isSafeInteger(empleado) || empleado <= 0) return volver("Elige su ficha de empleado de Odoo.", "error");
  if (conductor !== null && (!Number.isSafeInteger(conductor) || conductor <= 0)) return volver("Elige su contacto conductor o «Ninguno».", "error");

  const { datos, error } = await llamarPythonDetalle<RespuestaVinculos>("/api/odoo/vinculos/pendientes", { espera: 25000 });
  if (!datos) return volver(error ?? "No se ha podido comprobar la ficha en Odoo. Inténtalo de nuevo.", "error");
  const p = datos.pendientes.find((x) => x.id === persona);
  if (!p) return volver("Esta persona ya no está pendiente o no está en tus centros. Recarga la página.", "error");
  if (!p.empleados.some((c) => c.id === empleado && elegible(c))) return volver("Esa ficha de empleado ya no se puede elegir. Recarga la página.", "error");
  if (conductor !== null && !p.conductores.some((c) => c.id === conductor && elegible(c))) {
    return volver("Ese contacto conductor ya no se puede elegir. Recarga la página.", "error");
  }

  const { error: fallo } = await supabase.rpc("confirmar_vinculo_odoo", { persona, empleado, conductor });
  if (fallo) return volver(MENSAJES_BASE.includes(fallo.code) ? fallo.message : "No se ha podido guardar el enlace. Inténtalo de nuevo.", "error");
  revalidatePath("/equipo/odoo");
  revalidatePath("/equipo");
  return volver(`${p.nombre} ya está enlazada con su ficha de Odoo. Sus fichajes y vacaciones irán a esa ficha.`);
}

/** Deshacer un enlace confirmado: la persona queda sin ficha de Odoo (servicios/rrhh.py puede volver a buscarla sola
 *  por su correo o su código, sin confirmar) y vuelve a «Por enlazar». */
export async function deshacerVinculo(form: FormData) {
  const { supabase } = await conPermiso("personas.vincular");
  const persona = String(form.get("persona") ?? "");
  if (!persona) return volver("Falta la persona.", "error");
  const { error } = await supabase.rpc("deshacer_vinculo_odoo", { persona });
  if (error) return volver(MENSAJES_BASE.includes(error.code) ? error.message : "No se ha podido deshacer el enlace. Inténtalo de nuevo.", "error");
  revalidatePath("/equipo/odoo");
  revalidatePath("/equipo");
  return volver("Enlace deshecho. La persona vuelve a estar en «Por enlazar».");
}
