"use server";
import { revalidatePath } from "next/cache";
import { conPermiso } from "@/lib/usuario";
import { volverA } from "@/lib/volver";

/** Vuelve a «Equipos» con los mismos filtros (equipo abierto y búsqueda) y el mensaje. */
const volver = (msg: string, tipo: "ok" | "error" = "ok") => volverA("/equipos", msg, tipo);

const idEquipo = (form: FormData) => {
  const id = Number(form.get("equipo_id"));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nombre y descripción del formulario, ya limpios; null si el nombre no vale. */
function datosEquipo(form: FormData) {
  const nombre = String(form.get("nombre") ?? "").trim().replace(/\s+/g, " ");
  const descripcion = String(form.get("descripcion") ?? "").trim().slice(0, 200) || null;
  return nombre.length >= 2 && nombre.length <= 80 ? { nombre, descripcion } : null;
}

// Todas exigen «equipos.crear»; además, la base de datos solo deja tocar los equipos propios (o todos, a la
// administración). Un equipo no da permisos: solo organiza.
export async function crearEquipo(form: FormData) {
  const { supabase, uid } = await conPermiso("equipos.crear");
  const datos = datosEquipo(form);
  if (!datos) return volver("Pon un nombre al equipo, de 2 a 80 letras.", "error");
  const { data, error } = await supabase.from("equipos_trabajo").insert(datos).select("id").single<{ id: number }>();
  if (error || !data) return volver("No se ha podido crear el equipo. Inténtalo de nuevo.", "error");
  // Quien lo crea entra en él: así lo ve como uno más y, cuando haya chat, está en la conversación.
  await supabase.from("equipos_trabajo_miembros").insert({ equipo_id: data.id, usuario_id: uid });
  revalidatePath("/equipos");
  return volverA("/equipos", `Equipo «${datos.nombre}» creado. Ahora añade a las personas.`);
}

export async function cambiarEquipo(form: FormData) {
  const { supabase } = await conPermiso("equipos.crear");
  const id = idEquipo(form);
  const datos = datosEquipo(form);
  if (!id || !datos) return volver("Pon un nombre al equipo, de 2 a 80 letras.", "error");
  const { data, error } = await supabase.from("equipos_trabajo").update(datos).eq("id", id).select("id");
  if (error || !data?.length) return volver("No se ha podido cambiar: solo lo puede hacer quien creó el equipo.", "error");
  revalidatePath("/equipos");
  return volver("Equipo guardado.");
}

export async function archivarEquipo(form: FormData) {
  const { supabase } = await conPermiso("equipos.crear");
  const id = idEquipo(form);
  const activo = form.get("activo") === "true";
  if (!id) return volver("No se ha encontrado el equipo.", "error");
  const { data, error } = await supabase.from("equipos_trabajo").update({ activo }).eq("id", id).select("id");
  if (error || !data?.length) return volver("No se ha podido cambiar: solo lo puede hacer quien creó el equipo.", "error");
  revalidatePath("/equipos");
  return volverA("/equipos", activo ? "Equipo recuperado." : "Equipo archivado. Sus personas ya no lo ven; puedes recuperarlo cuando quieras.");
}

export async function anadirPersona(form: FormData) {
  const { supabase } = await conPermiso("equipos.crear");
  const equipo_id = idEquipo(form);
  const usuario_id = String(form.get("usuario_id") ?? "");
  if (!equipo_id || !UUID.test(usuario_id)) return volver("Elige a la persona que quieres añadir.", "error");
  const { error } = await supabase.from("equipos_trabajo_miembros").insert({ equipo_id, usuario_id });
  if (error?.code === "23505") return volver("Esa persona ya está en el equipo.", "error");
  if (error) return volver("No se ha podido añadir. Comprueba que el equipo es tuyo y no está archivado.", "error");
  revalidatePath("/equipos");
  return volver("Persona añadida al equipo.");
}

export async function quitarPersona(form: FormData) {
  const { supabase } = await conPermiso("equipos.crear");
  const equipo_id = idEquipo(form);
  const usuario_id = String(form.get("usuario_id") ?? "");
  if (!equipo_id || !UUID.test(usuario_id)) return volver("Elige a la persona que quieres quitar.", "error");
  const { data, error } = await supabase.from("equipos_trabajo_miembros").delete()
    .eq("equipo_id", equipo_id).eq("usuario_id", usuario_id).select("usuario_id");
  if (error || !data?.length) return volver("No se ha podido quitar: solo lo puede hacer quien creó el equipo.", "error");
  revalidatePath("/equipos");
  return volver("Persona quitada del equipo.");
}
