"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { leerFichajesJornada } from "@/lib/jornadas-servidor";
import { conPermiso } from "@/lib/usuario";
import { calcularJornada, avisoJornada, SIGUIENTES, type Fichaje } from "@/lib/jornada";
import { resultadoEnvio, type EnvioFichajes } from "@/lib/envioOdoo";
import { enviarFichajesDespues, llamarPython } from "@/lib/python";

/** Se ficha desde el inicio o desde «Fichaje»: se vuelve a la misma pantalla (solo esas dos). */
const pantalla = (form: FormData) => (form.get("volver") === "/" ? "/" : "/fichaje");
const volver = (a: string, msg: string, tipo: "ok" | "error" = "ok") => redirect(`${a}?${tipo}=${encodeURIComponent(msg)}`);

/** Fichar ahora. Se comprueba en el servidor que el paso tiene sentido (no se puede salir sin haber entrado). */
export async function fichar(form: FormData) {
  const { supabase, uid } = await conPermiso("fichaje.fichar");
  const a = pantalla(form);
  const tipo = String(form.get("tipo")) as Fichaje["tipo"];
  const { data, error: errorLeer } = await leerFichajesJornada(supabase, uid);
  if (errorLeer) return volver(a, "No se ha podido comprobar tu jornada. Inténtalo de nuevo en un momento.", "error");
  const resumen = calcularJornada(data);
  const { estado } = resumen;
  if (resumen.actual?.pendiente) return volver(a, avisoJornada(resumen.actual), "error");
  if (!SIGUIENTES[estado].includes(tipo)) return volver(a, "Ese fichaje no corresponde ahora. Recarga la página.", "error");
  const { error } = await supabase.from("fichajes").insert({ tipo, origen: "app" });
  // La base de datos rechaza un fichaje fuera de orden (p. ej. dos entradas seguidas desde dos móviles).
  if (error) return volver(a, error.code === "23514" ? error.message
    : "No se ha podido fichar. Inténtalo de nuevo.", "error");
  enviarFichajesDespues();
  revalidatePath("/");
  revalidatePath("/fichaje");
  volver(a, { entrada: "Entrada fichada.", pausa: "Pausa anotada.", reanudar: "Vuelta anotada.", salida: "Salida fichada. ¡Hasta mañana!" }[tipo]);
}

export async function reintentarOdoo(form: FormData) {
  await conPermiso("fichaje.fichar", "chofer.usar");
  const r = await llamarPython<EnvioFichajes>("/api/rrhh/fichajes/sincronizar", { method: "POST", body: {} });
  revalidatePath("/");
  revalidatePath("/fichaje");
  const { texto, bien } = resultadoEnvio(r, "tu");
  volver(pantalla(form), bien ? texto : `${texto} Avisa a tu responsable.`, bien ? "ok" : "error");
}
