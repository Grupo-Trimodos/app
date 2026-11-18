"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/usuario";

/** Se pide desde el inicio o desde «Mi perfil»: se vuelve a la misma pantalla (solo esas dos). */
const volver = (form: FormData, msg: string, tipo: "ok" | "error" = "ok"): never =>
  redirect(`${form.get("volver") === "/perfil" ? "/perfil" : "/"}?${tipo}=${encodeURIComponent(msg)}`);

/** La persona guarda su móvil (solo quien entra con código y PIN). La base de datos lo normaliza, lo guarda aparte
 *  (public.telefonos_personas, que solo ven ella y quien puede enlazarla) y solo deja cambiar el propio, y solo mientras
 *  su responsable no haya confirmado su ficha de Odoo (public.guardar_mi_telefono). */
export async function guardarMiTelefono(form: FormData) {
  const { supabase, perfil } = await usuarioActual();
  if (!perfil?.activo) redirect("/");
  const texto = String(form.get("telefono") ?? "").trim().slice(0, 40);
  if (!texto) return volver(form, "Escribe tu número de móvil.", "error");
  const { error } = await supabase.rpc("guardar_mi_telefono", { texto });
  if (error) {
    return volver(form, ["22023", "42501"].includes(error.code) ? error.message : "No se ha podido guardar tu móvil. Inténtalo de nuevo.", "error");
  }
  revalidatePath("/");
  revalidatePath("/perfil");
  return volver(form, "Móvil guardado. Tu responsable lo usará para comprobar tu ficha de empleado.");
}
