"use server";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { leerFichajesJornada } from "@/lib/jornadas-servidor";
import { conPermiso } from "@/lib/usuario";
import { calcularJornada, avisoJornada, horaCorta, SIGUIENTES, type Fichaje } from "@/lib/jornada";
import { resultadoEnvio, type EnvioFichajes } from "@/lib/envioOdoo";
import { enviarFichajesDespues, llamarPython } from "@/lib/python";

/** Se ficha desde el inicio o desde «Fichaje»: se vuelve a la misma pantalla (solo esas dos). */
const pantalla = (form: FormData) => (form.get("volver") === "/" ? "/" : "/fichaje");
const volver = (a: string, msg: string, tipo: "ok" | "error" = "ok") => redirect(`${a}?${tipo}=${encodeURIComponent(msg)}`);

export type ResultadoFichaje = { ok: boolean; mensaje: string; tipo: Fichaje["tipo"] };

const HECHO: Record<Fichaje["tipo"], (h: string) => string> = {
  entrada: (h) => `Entrada fichada a las ${h}.`,
  pausa: (h) => `Pausa empezada a las ${h}.`,
  reanudar: (h) => `De vuelta al trabajo a las ${h}.`,
  salida: (h) => `Salida fichada a las ${h}. ¡Hasta la próxima!`,
};

/** Fichar ahora. Se comprueba en el servidor que el paso tiene sentido (no se puede salir sin haber entrado). */
async function registrar(tipoPedido: string): Promise<ResultadoFichaje> {
  const { supabase, uid } = await conPermiso("fichaje.fichar");
  const tipo = tipoPedido as Fichaje["tipo"];
  const mal = (mensaje: string): ResultadoFichaje => ({ ok: false, mensaje, tipo });
  const { data, error: errorLeer } = await leerFichajesJornada(supabase, uid);
  if (errorLeer) return mal("No se ha podido comprobar tu jornada. Inténtalo de nuevo en un momento.");
  const resumen = calcularJornada(data);
  const { estado } = resumen;
  if (resumen.actual?.pendiente) return mal(avisoJornada(resumen.actual));
  if (!SIGUIENTES[estado].includes(tipo)) return mal("Ese fichaje ya no corresponde: tu jornada ha cambiado. Mira cómo está y vuelve a intentarlo.");
  const { data: nuevo, error } = await supabase.from("fichajes").insert({ tipo, origen: "app" })
    .select("momento").maybeSingle<{ momento: string }>();
  // La base de datos rechaza un fichaje fuera de orden (p. ej. dos entradas seguidas desde dos móviles).
  if (error) return mal(error.code === "23514" ? error.message : "No se ha podido fichar. Inténtalo de nuevo.");
  enviarFichajesDespues();
  revalidatePath("/");
  revalidatePath("/fichaje");
  return { ok: true, mensaje: HECHO[tipo](horaCorta(nuevo?.momento ?? new Date().toISOString())), tipo };
}

/** Formulario clásico (inicio de oficina): guarda y vuelve a la pantalla con el resultado en la dirección. */
export async function fichar(form: FormData) {
  const a = pantalla(form);
  const r = await registrar(String(form.get("tipo")));
  volver(a, r.mensaje, r.ok ? "ok" : "error");
}

/** Botón de la tarjeta de jornada (inicio de campo y «Mis fichajes»): devuelve el resultado a la pantalla, que lo
 *  enseña sin tocar la dirección (al recargar no reaparece), y refresca los datos de la página. */
export async function ficharAhora(tipo: string): Promise<ResultadoFichaje> {
  const r = await registrar(tipo);
  refresh();
  return r;
}

export async function reintentarOdoo(form: FormData) {
  await conPermiso("fichaje.fichar", "chofer.usar");
  const r = await llamarPython<EnvioFichajes>("/api/rrhh/fichajes/sincronizar", { method: "POST", body: {} });
  revalidatePath("/");
  revalidatePath("/fichaje");
  const { texto, bien } = resultadoEnvio(r, "tu");
  volver(pantalla(form), bien ? texto : `${texto} Avisa a tu responsable.`, bien ? "ok" : "error");
}
