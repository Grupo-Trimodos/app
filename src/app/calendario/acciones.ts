"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { enlaceValido, leerHorario, type DatosEvento } from "@/lib/calendario";
import { hoyISO } from "@/lib/jornada";
import { borrarEventoOutlook, calendarioActivo, cambiarEventoOutlook, crearEventoOutlook } from "@/lib/outlook";
import { conPermiso } from "@/lib/usuario";

/** Vuelve al mes que estaba mirando (sin formularios abiertos) con el mensaje. */
function volver(form: FormData, msg: string, tipo: "ok" | "error" = "ok"): never {
  const mes = String(form.get("mes") ?? "");
  const destino = /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? mes : hoyISO().slice(0, 7);
  redirect(`/calendario?mes=${destino}&${tipo}=${encodeURIComponent(msg)}`);
}
/** Si falla al guardar, vuelve con el formulario abierto para no perder el sitio. */
function volverAlFormulario(form: FormData, abrir: string, msg: string): never {
  const mes = String(form.get("mes") ?? "");
  const destino = /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? mes : hoyISO().slice(0, 7);
  redirect(`/calendario?mes=${destino}&${abrir}&error=${encodeURIComponent(msg)}#formulario`);
}

const id = (form: FormData) => {
  const n = Number(form.get("id"));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const texto = (form: FormData, campo: string, max: number) => String(form.get(campo) ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const largo = (form: FormData, campo: string, max: number) => String(form.get(campo) ?? "").trim().slice(0, max) || null;
const horario = (form: FormData) => leerHorario({
  fecha: String(form.get("fecha") ?? ""), hora: String(form.get("hora") ?? ""), fecha_fin: String(form.get("fecha_fin") ?? ""),
  hora_fin: String(form.get("hora_fin") ?? ""), todo_el_dia: form.get("todo_el_dia") === "on",
});
const rutas = () => { revalidatePath("/calendario"); revalidatePath("/"); };

// ---------------------------------------------------------------- notas propias
// La base de datos solo deja tocar las notas propias (RLS): aquí no hace falta comprobar de quién es.
export async function guardarNota(form: FormData) {
  const { supabase, uid } = await conPermiso("calendario.usar");
  const nota = id(form);
  const abrir = nota ? `editar=nota-${nota}` : "nueva=nota";
  const titulo = texto(form, "titulo", 120);
  if (!titulo) return volverAlFormulario(form, abrir, "Escribe qué quieres apuntar.");
  const h = horario(form);
  if ("error" in h) return volverAlFormulario(form, abrir, h.error);
  const datos = { titulo, detalle: largo(form, "detalle", 500), ...h };

  if (nota) {
    const { data, error } = await supabase.from("calendario_notas").update(datos).eq("id", nota)
      .select("id,outlook_evento_id").maybeSingle<{ id: number; outlook_evento_id: string | null }>();
    if (error || !data) return volverAlFormulario(form, abrir, "No se ha podido guardar la nota. Inténtalo de nuevo.");
    let extra = "";
    if (data.outlook_evento_id && calendarioActivo()) {
      const bien = await cambiarEventoOutlook(uid, data.outlook_evento_id, datos).catch(() => false);
      extra = bien ? " También se ha cambiado en tu Outlook." : " No se ha podido cambiar en tu Outlook: cámbiala allí.";
    }
    rutas();
    return volver(form, `Nota guardada.${extra}`);
  }

  const { data, error } = await supabase.from("calendario_notas").insert(datos).select("id").single<{ id: number }>();
  if (error || !data) return volverAlFormulario(form, abrir, "No se ha podido guardar la nota. Inténtalo de nuevo.");
  let extra = "";
  if (form.get("outlook") === "on" && calendarioActivo()) {
    const evento = await crearEventoOutlook(uid, datos, `trimodos-nota-${data.id}`).catch(() => null);
    if (evento) {
      const vinculo = await supabase.from("calendario_notas").update({ outlook_evento_id: evento }).eq("id", data.id)
        .select("id").maybeSingle();
      extra = vinculo.error || !vinculo.data
        ? " Se ha creado en Outlook, pero no se pudo vincular con esta nota. Si la cambias, revisa también el evento en Outlook."
        : " También está en tu Outlook.";
    } else extra = " No se ha podido añadir a tu Outlook: sal y vuelve a entrar con Microsoft.";
  }
  rutas();
  return volver(form, `Nota apuntada.${extra}`);
}

export async function borrarNota(form: FormData) {
  const { supabase, uid } = await conPermiso("calendario.usar");
  const nota = id(form);
  if (!nota) return volver(form, "No se ha encontrado la nota.", "error");
  const { data, error } = await supabase.from("calendario_notas").delete().eq("id", nota)
    .select("outlook_evento_id").maybeSingle<{ outlook_evento_id: string | null }>();
  if (error || !data) return volver(form, "No se ha podido borrar la nota.", "error");
  let extra = "";
  if (data.outlook_evento_id && form.get("tambien_outlook") === "on" && calendarioActivo()) {
    const bien = await borrarEventoOutlook(uid, data.outlook_evento_id).catch(() => false);
    extra = bien ? " También se ha borrado de tu Outlook." : " No se ha podido borrar de tu Outlook: bórrala allí.";
  }
  rutas();
  return volver(form, `Nota borrada.${extra}`);
}

// ---------------------------------------------------------------- fechas señaladas
/** «todos», «centro:12» o «equipo:3» → columnas. La base de datos comprueba que ese centro o equipo es de quien publica. */
function destinatarios(valor: string): { alcance: string; centro_id: number | null; equipo_id: number | null } | null {
  if (valor === "todos") return { alcance: "todos", centro_id: null, equipo_id: null };
  const m = /^(centro|equipo):(\d{1,12})$/.exec(valor);
  if (!m) return null;
  return m[1] === "centro" ? { alcance: "centro", centro_id: Number(m[2]), equipo_id: null }
    : { alcance: "equipo", centro_id: null, equipo_id: Number(m[2]) };
}

export async function guardarFecha(form: FormData) {
  const { supabase } = await conPermiso("calendario.publicar");
  const fecha = id(form);
  const abrir = fecha ? `editar=fecha-${fecha}` : "nueva=fecha";
  const titulo = texto(form, "titulo", 120);
  if (!titulo) return volverAlFormulario(form, abrir, "Pon un título a la fecha señalada.");
  const h = horario(form);
  if ("error" in h) return volverAlFormulario(form, abrir, h.error);
  const enlace = enlaceValido(String(form.get("enlace") ?? ""));
  if (enlace === false) return volverAlFormulario(form, abrir, "El enlace tiene que empezar por https:// (o http://).");
  const para = destinatarios(String(form.get("para") ?? ""));
  if (!para) return volverAlFormulario(form, abrir, "Elige para quién es.");
  const datos = { titulo, detalle: largo(form, "detalle", 1000), lugar: texto(form, "lugar", 120) || null, enlace, ...h, ...para };

  const { data, error } = fecha
    ? await supabase.from("fechas_senaladas").update(datos).eq("id", fecha).select("id")
    : await supabase.from("fechas_senaladas").insert(datos).select("id");
  if (error?.code === "42501" || (!error && !data?.length))
    return volverAlFormulario(form, abrir, "No puedes publicar para ese centro o equipo. Elige uno de los tuyos.");
  if (error) return volverAlFormulario(form, abrir, "No se ha podido guardar la fecha señalada. Inténtalo de nuevo.");
  rutas();
  return volver(form, fecha ? "Fecha señalada guardada." : "Fecha señalada publicada.");
}

export async function archivarFecha(form: FormData) {
  const { supabase } = await conPermiso("calendario.publicar");
  const fecha = id(form);
  const activo = form.get("activo") === "true";
  if (!fecha) return volver(form, "No se ha encontrado la fecha señalada.", "error");
  const { data, error } = await supabase.from("fechas_senaladas").update({ activo }).eq("id", fecha).select("id");
  if (error || !data?.length) return volver(form, "No se ha podido cambiar: solo lo puede hacer quien la publicó.", "error");
  rutas();
  return volver(form, activo ? "Fecha señalada recuperada." : "Fecha señalada archivada. Ya no la ve nadie más; puedes recuperarla.");
}

/** Copia una fecha señalada que ve en su propio Outlook. */
export async function fechaAMiOutlook(form: FormData) {
  const { supabase, uid } = await conPermiso("calendario.usar", "calendario.publicar");
  const fecha = id(form);
  if (!fecha || !calendarioActivo()) return volver(form, "Tu Outlook no está conectado.", "error");
  const { data } = await supabase.from("fechas_senaladas").select("titulo,detalle,lugar,enlace,empieza,termina,todo_el_dia")
    .eq("id", fecha).eq("activo", true).maybeSingle<DatosEvento>();
  if (!data) return volver(form, "No se ha encontrado la fecha señalada.", "error");
  const evento = await crearEventoOutlook(uid, data, `trimodos-fecha-${fecha}`).catch(() => null);
  if (!evento) return volver(form, "No se ha podido añadir a tu Outlook: sal y vuelve a entrar con Microsoft.", "error");
  return volver(form, "Añadida a tu Outlook.");
}
