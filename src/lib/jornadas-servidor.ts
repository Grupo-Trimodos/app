import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularJornada, inicioDia, type Fichaje } from "./jornada";

/** Lee secuencias completas con RLS. Pagina para que el límite de filas no oculte cierres o personas. */
export async function leerFichajesJornada(supabase: SupabaseClient, persona: string | null = null,
  desde = inicioDia(), corregibles = false) {
  const data: Fichaje[] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await supabase.rpc("fichajes_para_jornada", { desde: desde.toISOString(), persona, corregibles })
      .order("momento").order("id").range(offset, offset + 499);
    if (r.error) return { data: [] as Fichaje[], error: r.error };
    data.push(...(r.data ?? []) as Fichaje[]);
    if ((r.data?.length ?? 0) < 500) return { data, error: null };
  }
}

export function jornadasPorPersona(fichajes: Fichaje[], ahora = new Date()) {
  const grupos = new Map<string, Fichaje[]>();
  for (const f of fichajes) {
    const grupo = grupos.get(f.usuario_id) ?? [];
    grupo.push(f); grupos.set(f.usuario_id, grupo);
  }
  return new Map([...grupos].map(([id, fs]) => [id, calcularJornada(fs, ahora)]));
}

export async function leerPendientesCierre(supabase: SupabaseClient) {
  const r = await leerFichajesJornada(supabase, null, inicioDia(), true);
  const jornadas = [...jornadasPorPersona(r.data).values()].flatMap((r) => r.actual?.pendiente ? [r.actual] : []);
  return { jornadas, error: r.error };
}
