"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { llamarPythonDetalle } from "@/lib/python";
import { conPermiso } from "@/lib/usuario";

const volver = (msg: string, tipo: "ok" | "error" = "ok"): never => redirect(`/equipo/odoo?${tipo}=${encodeURIComponent(msg)}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** «Son la misma persona». La confirmación solo la hace el servidor (POST /api/odoo/vinculos/confirmar): vuelve a pedir
 *  a Odoo las propuestas, solo acepta una ficha propuesta y libre, y la base de datos comprueba otra vez que la persona
 *  esté en tus centros y lo anota. Desde el navegador no se puede confirmar directamente. */
export async function confirmarVinculo(form: FormData) {
  await conPermiso("personas.vincular");
  const persona = String(form.get("persona") ?? "");
  const empleado = Number(form.get("empleado"));
  const textoConductor = String(form.get("conductor") ?? "");
  const conductor = textoConductor ? Number(textoConductor) : null;
  if (!UUID.test(persona) || !Number.isSafeInteger(empleado) || empleado <= 0) return volver("Elige su ficha de empleado de Odoo.", "error");
  if (conductor !== null && (!Number.isSafeInteger(conductor) || conductor <= 0)) return volver("Elige su contacto conductor o «Ninguno».", "error");

  const { datos, error } = await llamarPythonDetalle<{ nombre: string }>("/api/odoo/vinculos/confirmar",
    { method: "POST", body: { persona, empleado, conductor }, espera: 25000 });
  if (!datos) return volver(error ?? "No se ha podido guardar el enlace. Inténtalo de nuevo.", "error");
  revalidatePath("/equipo/odoo");
  revalidatePath("/equipo");
  return volver(`${datos.nombre} ya está enlazada con su ficha de Odoo. Sus fichajes y vacaciones irán a esa ficha.`);
}

/** Deshacer un enlace confirmado (también solo desde el servidor). La persona queda sin ficha de Odoo y vuelve a «Por
 *  enlazar»; la ficha que tenía queda descartada: la app no se la vuelve a poner sola por su correo o su código. */
export async function deshacerVinculo(form: FormData) {
  await conPermiso("personas.vincular");
  const persona = String(form.get("persona") ?? "");
  if (!UUID.test(persona)) return volver("Falta la persona.", "error");
  const { datos, error } = await llamarPythonDetalle<{ nombre: string }>("/api/odoo/vinculos/deshacer",
    { method: "POST", body: { persona }, espera: 15000 });
  if (!datos) return volver(error ?? "No se ha podido deshacer el enlace. Inténtalo de nuevo.", "error");
  revalidatePath("/equipo/odoo");
  revalidatePath("/equipo");
  return volver(`Enlace de ${datos.nombre} deshecho. Vuelve a estar en «Por enlazar» y la app no le pondrá esa ficha por su cuenta.`);
}
