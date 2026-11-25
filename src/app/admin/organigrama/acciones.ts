"use server";
import { revalidatePath } from "next/cache";
import { volverA } from "@/lib/volver";
import { usuarioActual } from "@/lib/usuario";

/** Cada acción vuelve a comprobar el permiso en el servidor; la base de datos lo exige otra vez (RLS y funciones). */
async function exigir() {
  const r = await usuarioActual();
  if (!r.perfil?.activo || !r.puede("admin.usuarios")) throw new Error("No tienes permiso.");
  return r;
}

const volver = (msg: string, tipo: "ok" | "error" = "ok") => volverA("/admin/organigrama", msg, tipo);
const RUTA = "/admin/organigrama";

export async function cambiarInterruptor(form: FormData) {
  const { supabase, uid } = await exigir();
  const aplicar = form.get("aplicar") === "si";
  const { error } = await supabase.from("organigrama_ajustes").update({ aplicar, autor: uid, cambiado: new Date().toISOString() }).eq("id", true);
  if (error) return volver("No se ha podido cambiar. Inténtalo de nuevo.", "error");
  if (!aplicar) {
    revalidatePath(RUTA);
    return volver("Apagado. Nadie pierde los perfiles que ya tiene; solo se deja de aplicar el organigrama.");
  }
  const { data, error: e2 } = await supabase.rpc("aplicar_perfiles_organigrama");
  revalidatePath(RUTA);
  if (e2) return volver("Encendido, pero no se han podido aplicar los perfiles ahora. Se aplicarán en la próxima sincronización.", "error");
  const r = (data ?? {}) as { estado?: string; puestos?: number; quitados?: number };
  if (r.estado === "sin_foto") return volver("Encendido. Aún no hay foto del organigrama: lanza la sincronización con Odoo.");
  return volver(`Encendido y aplicado: ${r.puestos ?? 0} perfiles puestos y ${r.quitados ?? 0} quitados.`);
}

export async function aplicarAhora() {
  const { supabase } = await exigir();
  const { data, error } = await supabase.rpc("aplicar_perfiles_organigrama");
  revalidatePath(RUTA);
  if (error) return volver("No se han podido aplicar los perfiles. Inténtalo de nuevo.", "error");
  const r = (data ?? {}) as { estado?: string; puestos?: number; quitados?: number };
  if (r.estado === "apagado") return volver("Está apagado: enciéndelo primero.", "error");
  if (r.estado === "sin_foto") return volver("Aún no hay foto del organigrama: lanza la sincronización con Odoo.", "error");
  return volver(`Aplicado: ${r.puestos ?? 0} perfiles puestos y ${r.quitados ?? 0} quitados.`);
}

export async function guardarPuesto(form: FormData) {
  const { supabase } = await exigir();
  const puesto = String(form.get("puesto") ?? "").trim().toLowerCase();
  const perfil = Number(form.get("perfil") || 0);
  if (puesto.length < 2 || puesto.length > 80) return volver("Puesto no válido.", "error");
  if (!perfil) {
    const { error } = await supabase.from("puestos_perfil").delete().eq("puesto", puesto);
    revalidatePath(RUTA);
    return error ? volver("No se ha podido guardar. Inténtalo de nuevo.", "error")
      : volver(`«${puesto}» ya no da ningún perfil. Se notará al aplicar.`);
  }
  const { error } = await supabase.from("puestos_perfil").upsert({ puesto, perfil_id: perfil, cambiado: new Date().toISOString() });
  revalidatePath(RUTA);
  return error ? volver("No se ha podido guardar. Inténtalo de nuevo.", "error") : volver(`Guardado el perfil de «${puesto}». Se notará al aplicar.`);
}

export async function anadirFicha(form: FormData) {
  const { supabase, uid } = await exigir();
  const persona = String(form.get("persona") ?? "");
  const empleado = Number(form.get("empleado") || 0);
  if (!persona || !Number.isInteger(empleado) || empleado <= 0) return volver("Elige la persona y la ficha.", "error");
  const { error } = await supabase.from("usuario_fichas_extra").insert({ usuario_id: persona, empleado_id: empleado, autor: uid });
  revalidatePath(RUTA);
  if (error?.code === "23505") return volver("Esa ficha ya es de otra persona de la app.", "error");
  return error ? volver("No se ha podido guardar. Inténtalo de nuevo.", "error")
    : volver("Ficha añadida. Cuenta para el organigrama y el alcance; los fichajes siguen yendo a su ficha principal.");
}

export async function quitarFicha(form: FormData) {
  const { supabase } = await exigir();
  const empleado = Number(form.get("empleado") || 0);
  const { error } = await supabase.from("usuario_fichas_extra").delete().eq("empleado_id", empleado);
  revalidatePath(RUTA);
  return error ? volver("No se ha podido quitar. Inténtalo de nuevo.", "error") : volver("Ficha quitada.");
}
