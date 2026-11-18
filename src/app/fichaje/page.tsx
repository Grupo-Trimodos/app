import Link from "next/link";
import OrigenDato from "../OrigenDato";
import RelojJornada from "../RelojJornada";
import Icono from "../Icono";
import { leerFichajesJornada } from "@/lib/jornadas-servidor";
import Cabecera from "../Cabecera";
import EstadoOdoo from "../EstadoOdoo";
import { conPermiso } from "@/lib/usuario";
import {
  diaLargo, diaMadrid, duracionMs, horaCorta, inicioDia, JORNADA_SEMANAL_HORAS, lunesDe, madridAInstante, NOMBRE_TIPO,
  periodoPedido, registroDeJornadas, sumarDias, textoCorreccion, textoEntradaSalida, textoPausas, type DiaDelRegistro,
} from "@/lib/jornada";
import { reintentarOdoo } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mis fichajes · Grupo Trimodos" };

const ESTADO_JORNADA: Record<string, { texto: string; clase: string } | undefined> = {
  trabajando: { texto: "Trabajando", clase: "trabajando" },
  pausa: { texto: "En pausa", clase: "pausa" },
  pendiente: { texto: "Falta la salida: la anotará tu responsable", clase: "ojo" },
  revisar: { texto: "Tu responsable tiene que revisarla", clase: "ojo" },
};
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * «Mis fichajes»: la tarjeta de jornada (la misma del inicio) y su registro por semana o por mes, con cada día (entrada,
 * salida, pausas y total), el total frente a las 40 h de la semana y el enlace para descargar el registro del mes. Lo que
 * corrigió el responsable se ve con su motivo. En la app del móvil (pantalla «campo») no se enseña nada del envío a
 * Odoo; en la de oficina se mantienen el estado de lo fichado hoy y el reintento.
 */
export default async function PaginaFichaje({ searchParams }: {
  searchParams: Promise<{ ok?: string; error?: string; semana?: string; mes?: string }>;
}) {
  const { supabase, uid, perfil, pantalla } = await conPermiso("fichaje.fichar");
  const { ok, error, semana, mes } = await searchParams;
  const conOdoo = pantalla !== "campo";
  const ahora = new Date();
  const hoy = diaMadrid(ahora);
  const periodo = periodoPedido({ semana, mes }, ahora);
  // Desde el principio del período (o del lunes, para la tarjeta de la jornada): secuencias completas.
  const leerDesde = [periodo.desde, lunesDe(hoy)].sort()[0];
  const { data: todos, error: errorLeer } = await leerFichajesJornada(supabase, uid, madridAInstante(`${leerDesde}T00:00`)!);
  const registro = registroDeJornadas(todos, periodo.desde, periodo.hasta, ahora);
  const porDia = new Map(registro.dias.map((d) => [d.dia, d]));
  // Semana: los siete días hasta hoy, también los que no se fichó. Mes: solo los días con fichajes.
  const dias: DiaDelRegistro[] = periodo.vista === "semana"
    ? Array.from({ length: 7 }, (_, i) => sumarDias(periodo.desde, i)).filter((d) => d <= hoy)
      .map((d) => porDia.get(d) ?? { dia: d, jornadas: [], ms: 0 })
    : registro.dias;
  const hoyFichajes = todos.filter((f) => new Date(f.momento).getTime() >= inicioDia().getTime());
  const pendientesOdoo = todos.some((f) => f.odoo_estado === "error" || f.odoo_estado === "pendiente");
  const mesDescarga = (periodo.hasta < hoy ? periodo.hasta : hoy).slice(0, 7);
  const enlace = (p: string) => `/fichaje?${periodo.vista}=${p}`;
  const objetivo = JORNADA_SEMANAL_HORAS * 3600000;
  const porcentaje = Math.min(100, Math.round((registro.ms / objetivo) * 100));

  return (
    <>
      <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
      <main className="contenido estrecho campo-oscuro">
        <h1>Mis fichajes</h1>
        {conOdoo && <OrigenDato fuente="App · Registro de jornada"><p>Entradas, pausas y salidas registradas en la app. Cada movimiento indica si está pendiente, enviado a Odoo o necesita revisión.</p></OrigenDato>}
        {ok && <p className="aviso" role="status">{ok}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        <div className="campo">
          <RelojJornada fichajes={todos} instante={ahora.toISOString()} error={!!errorLeer} />

          {conOdoo && <section className="campo-tarjeta" aria-labelledby="fichajes-hoy">
            <h2 id="fichajes-hoy">Hoy</h2>
            {hoyFichajes.length === 0 ? <p className="hint">Todavía no has fichado hoy.</p> : (
              <ul className="campo-lista">
                {hoyFichajes.map((f) => (
                  <li key={f.id}>
                    <b>{horaCorta(f.momento)}</b>
                    <span>{NOMBRE_TIPO[f.tipo]}
                      {f.origen === "camion" && <small>Al confirmar el camión</small>}
                      {f.origen === "correccion" && <small>Anotado por tu responsable{f.nota ? `: ${f.nota}` : ""}</small>}
                      <small><EstadoOdoo estado={f.odoo_estado} error={f.odoo_error} detalle /></small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {pendientesOdoo && (
              <form action={reintentarOdoo}><button className="btn pequeno">Reintentar envío a Odoo</button></form>
            )}
          </section>}

          <section className="campo-tarjeta campo-registro" aria-labelledby="registro-t">
            <h2 id="registro-t" className="sr-only">Mi registro de jornada</h2>
            <nav className="campo-pestanas" aria-label="Ver por">
              <Link href="/fichaje" scroll={false} aria-current={periodo.vista === "semana" ? "page" : undefined}>Semana</Link>
              <Link href={`/fichaje?mes=${mesDescarga}`} scroll={false} aria-current={periodo.vista === "mes" ? "page" : undefined}>Mes</Link>
            </nav>
            <div className="campo-periodo">
              <Link href={enlace(periodo.anterior)} scroll={false} className="campo-periodo-btn"
                aria-label={periodo.vista === "semana" ? "Semana anterior" : "Mes anterior"}><Icono nombre="flecha" size={24} /></Link>
              <p><b>{periodo.titulo}</b>{periodo.actual && <small>{periodo.vista === "semana" ? "Esta semana" : "Este mes"}</small>}</p>
              {periodo.siguiente ? <Link href={enlace(periodo.siguiente)} scroll={false} className="campo-periodo-btn siguiente"
                aria-label={periodo.vista === "semana" ? "Semana siguiente" : "Mes siguiente"}><Icono nombre="flecha" size={24} /></Link>
                : <span className="campo-periodo-btn vacio" aria-hidden="true" />}
            </div>

            {errorLeer ? <p className="error" role="alert">No se han podido consultar tus fichajes. Recarga la página.</p> : <>
              <div className="campo-total">
                <p>{periodo.vista === "semana" ? "Total de la semana" : "Total del mes"}</p>
                <p className="campo-total-cifra">{duracionMs(registro.ms)}
                  {periodo.vista === "semana" && <small> de {JORNADA_SEMANAL_HORAS} h</small>}</p>
                {periodo.vista === "semana" && <div className="campo-horas-barra" aria-hidden="true"><i style={{ width: `${porcentaje}%` }} /></div>}
              </div>

              {dias.length === 0 ? <p className="hint">No hay fichajes {periodo.vista === "semana" ? "esta semana" : "en este mes"}.</p>
                : <ul className="campo-dias">
                  {[...dias].reverse().map((d) => <li key={d.dia} className={d.dia === hoy ? "hoy" : undefined}>
                    <div className="campo-dia-cabecera">
                      <b>{d.dia === hoy ? "Hoy" : mayuscula(diaLargo(d.dia))}</b>
                      {d.jornadas.length > 0 && <strong>{duracionMs(d.ms)}</strong>}
                    </div>
                    {d.jornadas.length === 0 && <p className="campo-dia-vacio">Sin fichajes</p>}
                    {d.jornadas.map((j) => {
                      const estado = ESTADO_JORNADA[j.estado];
                      const pausas = textoPausas(j);
                      return <div key={j.jornada.entrada.id} className="campo-dia-jornada">
                        <p className="campo-dia-horas">{textoEntradaSalida(j)}
                          {d.jornadas.length > 1 && j.cuenta && <span>{duracionMs(j.ms)}</span>}</p>
                        {estado && <p className={`campo-dia-estado ${estado.clase}`}>{estado.texto}</p>}
                        {pausas && <p className="campo-dia-detalle">{pausas}</p>}
                        {j.correcciones.map((c, i) => <p key={i} className="campo-dia-correccion">{textoCorreccion(c)}</p>)}
                      </div>;
                    })}
                  </li>)}
                </ul>}
            </>}

            <Link href={`/fichaje/registro?mes=${mesDescarga}`} className="btn ancho campo-descargar">
              <Icono nombre="documento" size={24} />Descargar mi registro</Link>
            <p className="hint">Es tu registro de jornada. Puedes descargarlo cuando quieras.</p>
          </section>
          <p className="hint">Si te has equivocado o se te olvidó fichar, díselo a tu responsable: lo corrige y queda anotado.</p>
        </div>
      </main>
    </>
  );
}
