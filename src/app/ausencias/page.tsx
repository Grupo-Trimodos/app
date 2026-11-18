import OrigenDato from "../OrigenDato";
import Cabecera from "../Cabecera";
import EstadoOdoo from "../EstadoOdoo";
import PedirDias from "./PedirDias";
import { conPermiso } from "@/lib/usuario";
import { leerFichajesJornada } from "@/lib/jornadas-servidor";
import {
  diasDeSolicitud, fechasSolicitud, horasTrabajadas, hoyISO, inicioHorasTrabajadas, madridAInstante, nombreMes,
  NOMBRE_AUSENCIA, partesDuracion, duracionMs,
} from "@/lib/jornada";
import { anularAusencia } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vacaciones · Grupo Trimodos" };

type Ausencia = { id: number; tipo: string; desde: string; hasta: string; motivo: string | null; estado: string;
  comentario: string | null; odoo_estado: string; odoo_error: string | null };
type Aprobador = { nombre: string; centro: string };

/** Estado de una solicitud, en palabras de quien la pidió. */
function estadoSolicitud(a: Ausencia) {
  if (a.estado === "pendiente") return "Pendiente de que la apruebe tu responsable";
  if (a.estado === "aprobada") return "Aprobada";
  if (a.estado === "rechazada") return a.comentario ? `Rechazada: ${a.comentario}` : "Rechazada";
  if (a.estado === "anulada") return "Anulada por ti";
  return a.estado;
}

/** A quién le llegan sus solicitudes (los responsables de su centro con permiso de aprobar), en una línea. */
function lineaAprobacion(quienes: Aprobador[] | null) {
  if (!quienes) return "Le llega a tu responsable.";
  if (!quienes.length) return "Le llega a la administración: tu centro todavía no tiene responsable.";
  const uno = (q: Aprobador) => (q.centro === "todos los centros" ? q.nombre : `${q.nombre} (${q.centro})`);
  if (quienes.length === 1) {
    const [q] = quienes;
    return q.centro === "todos los centros" ? `Le llega a ${q.nombre}, tu responsable.`
      : `Le llega a tu responsable de ${q.centro}: ${q.nombre}.`;
  }
  return `Le llega a tus responsables: ${quienes.map(uno).join(", ")}.`;
}

function Horas({ ms, grande = false }: { ms: number; grande?: boolean }) {
  const { h, min } = partesDuracion(ms);
  return <b className={grande ? "campo-cifra grande" : "campo-cifra"}>{h.toLocaleString("es-ES")}<small> h </small>
    {String(min).padStart(2, "0")}<small> min</small></b>;
}

/**
 * Vacaciones y permisos. Arriba, para quien ficha en la app del móvil, sus horas trabajadas (este año, este mes y esta
 * semana frente a 40 h): todavía no hay saldo de días, lo dará la empresa más adelante. Después, pedir días y sus
 * solicitudes. Al trabajador no se le enseña nada de Odoo; en la pantalla de oficina se mantiene el estado del envío.
 */
export default async function PaginaAusencias({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, uid, perfil, pantalla, esDeSuPuesto } = await conPermiso("ausencias.pedir");
  const { ok, error } = await searchParams;
  const campo = pantalla === "campo";
  const conHoras = campo && esDeSuPuesto("fichaje.fichar", "chofer.usar");
  const ahora = new Date();
  const hoy = hoyISO();
  const [{ data }, aprobadores, fichajes] = await Promise.all([
    supabase.from("ausencias").select("id,tipo,desde,hasta,motivo,estado,comentario,odoo_estado,odoo_error")
      .eq("usuario_id", uid).order("desde", { ascending: false }).limit(50),
    supabase.rpc("quien_me_aprueba", { permiso: "ausencias.aprobar" }),
    conHoras ? leerFichajesJornada(supabase, uid, madridAInstante(`${inicioHorasTrabajadas(ahora)}T00:00`)!) : null,
  ]);
  const lista = (data ?? []) as Ausencia[];
  const quien = lineaAprobacion(aprobadores.error ? null : (aprobadores.data ?? []) as Aprobador[]);
  const horas = fichajes && !fichajes.error ? horasTrabajadas(fichajes.data, ahora) : null;
  const porcentaje = horas ? Math.min(100, Math.round((horas.msSemana / horas.msObjetivo) * 100)) : 0;
  const anio = hoy.slice(0, 4);

  return (
    <>
      <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
      <main className={`contenido estrecho ${campo ? "campo-oscuro" : ""}`}>
        <h1>{campo ? "Vacaciones" : "Vacaciones y ausencias"}</h1>
        {!campo && <OrigenDato fuente="App · Solicitudes"><p>Estas solicitudes se gestionan en la app y las aprobadas se envían a Odoo. Esta lista no es el saldo de vacaciones de Odoo.</p></OrigenDato>}
        {ok && <p className="aviso" role="status">{ok}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        <div className="campo">
          {conHoras && <section className="campo-tarjeta campo-horas" aria-labelledby="horas-t">
            <h2 id="horas-t">Tus horas trabajadas</h2>
            {!horas ? <p className="hint">No se han podido consultar tus horas. Vuelve a intentarlo en un momento.</p> : <>
              <div className="campo-horas-cifras">
                <div><span>Este año</span><Horas ms={horas.msAnio} grande /></div>
                <div><span>{nombreMes(hoy).replace(/ de \d+$/, "")}</span><Horas ms={horas.msMes} grande /></div>
              </div>
              <div className="campo-horas-semana">
                <p>Esta semana: <b>{duracionMs(horas.msSemana)}</b> de {horas.msObjetivo / 3600000} h</p>
                <div className="campo-horas-barra" aria-hidden="true"><i style={{ width: `${porcentaje}%` }} /></div>
              </div>
            </>}
            <p className="campo-horas-nota">Tus días de vacaciones aparecerán aquí cuando la empresa los configure.</p>
          </section>}

          <PedirDias key={ok ?? "nueva"} hoy={hoy} quienAprueba={quien} />

          <section className="campo-tarjeta" aria-labelledby="mis-solicitudes-t">
            <h2 id="mis-solicitudes-t">Mis solicitudes</h2>
            {lista.length === 0 ? <p className="hint">Todavía no has pedido ninguna.</p> : (
              <ul className="campo-solicitudes">
                {lista.map((a) => {
                  const { laborables } = diasDeSolicitud(a.desde, a.hasta);
                  return <li key={a.id} className={`campo-solicitud ${a.estado}`}>
                    <p className="campo-solicitud-fechas">{fechasSolicitud(a.desde, a.hasta, anio)}</p>
                    <p>{NOMBRE_AUSENCIA[a.tipo] ?? "Permiso"} · {laborables === 1 ? "1 día laborable" : `${laborables} días laborables`}</p>
                    <p className="campo-solicitud-estado"><i aria-hidden="true" />{estadoSolicitud(a)}</p>
                    {a.estado === "pendiente" && <p className="campo-quien">{quien}</p>}
                    {a.estado === "aprobada" && a.comentario && <p className="hint">Tu responsable: {a.comentario}</p>}
                    {a.motivo && <p className="hint">Tu comentario: {a.motivo}</p>}
                    {!campo && a.estado === "aprobada" && <p><EstadoOdoo estado={a.odoo_estado} error={a.odoo_error} /></p>}
                    {a.estado === "pendiente" && (
                      <form action={anularAusencia}><input type="hidden" name="id" value={a.id} />
                        <button className="btn ancho campo-anular">Anular esta solicitud</button></form>
                    )}
                  </li>;
                })}
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
