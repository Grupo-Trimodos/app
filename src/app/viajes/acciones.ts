"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conPermiso } from "@/lib/usuario";
import { llamarPythonDetalle } from "@/lib/python";
import { BOTON_PASO, esPaso, siguientePaso } from "@/lib/viajes";

const volver = (msg: string, tipo: "ok" | "error", tarea?: number) =>
  redirect(`/viajes?${tipo}=${encodeURIComponent(msg)}${tarea ? `#orden-${tarea}` : ""}`);

/** La base de datos no puede preguntar a Odoo: antes de guardar, la API comprueba con el enlace de quien marca que la
 *  orden le ha llegado a él y sigue abierta (GET /api/chofer/viajes/{tarea}). */
async function ordenSuya(tarea: number) {
  const { error } = await llamarPythonDetalle(`/api/chofer/viajes/${tarea}`, { espera: 20000 });
  return error;
}

function leerTarea(form: FormData) {
  const tarea = Number(form.get("tarea"));
  return Number.isInteger(tarea) && tarea > 0 && tarea < 2 ** 31 ? tarea : null;
}

/** Mensaje de la base de datos (ya en español) solo si es una de sus comprobaciones; si no, uno general. */
const mensaje = (e: { code?: string; message: string }, general: string) =>
  e.code === "23514" || e.code === "42501" ? e.message : general;

/** Marca el siguiente paso de una orden: llegada, carga, descarga… Solo el que toca después del último. */
export async function marcarPaso(form: FormData) {
  const { supabase, uid } = await conPermiso("viajes.usar");
  const tarea = leerTarea(form);
  const estado = form.get("estado");
  if (!tarea || !esPaso(estado)) return volver("No se ha podido marcar el paso. Recarga la pantalla.", "error");
  const { data: hechos, error: fallo } = await supabase.from("viajes_estados").select("estado")
    .eq("usuario_id", uid).eq("odoo_task_id", tarea).order("momento").order("id");
  if (fallo) return volver("No se ha podido comprobar el viaje. Revisa la cobertura y vuelve a intentarlo.", "error", tarea);
  if (siguientePaso(hechos ?? []) !== estado) return volver("Ese paso ya estaba marcado o todavía no toca. Revisa la línea de tiempo.", "error", tarea);
  const noEsSuya = await ordenSuya(tarea);
  if (noEsSuya) return volver(noEsSuya, "error", tarea);
  const { error } = await supabase.from("viajes_estados").insert({ odoo_task_id: tarea, estado });
  if (error) return volver(mensaje(error, "No se ha podido guardar. Revisa la cobertura y vuelve a intentarlo."), "error", tarea);
  revalidatePath("/viajes");
  volver(`Anotado: ${BOTON_PASO[estado].toLowerCase()}.`, "ok", tarea);
}

/** Avisa de una incidencia en una orden (retraso, la carga no está lista, un paso marcado por error…). */
export async function marcarIncidencia(form: FormData) {
  const { supabase } = await conPermiso("viajes.usar");
  const tarea = leerTarea(form);
  const nota = String(form.get("nota") ?? "").trim().replace(/\s+/g, " ");
  if (!tarea) return volver("No se ha podido guardar la incidencia. Recarga la pantalla.", "error");
  if (!nota) return volver("Escribe qué ha pasado.", "error", tarea);
  if (nota.length > 200) return volver("Escribe la incidencia en menos de 200 letras.", "error", tarea);
  const noEsSuya = await ordenSuya(tarea);
  if (noEsSuya) return volver(noEsSuya, "error", tarea);
  const { error } = await supabase.from("viajes_estados").insert({ odoo_task_id: tarea, estado: "incidencia", nota });
  if (error) return volver(mensaje(error, "No se ha podido guardar. Revisa la cobertura y vuelve a intentarlo."), "error", tarea);
  revalidatePath("/viajes");
  volver("Incidencia anotada. Si es urgente, llama también a tráfico.", "ok", tarea);
}
