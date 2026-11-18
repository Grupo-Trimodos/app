import Link from "next/link";
import BotonCalendario from "./BotonCalendario";
import Cabecera from "../Cabecera";
import Icono from "../Icono";
import {
  camposDe, diaCorto, diaLargo, diasDelMes, diasQueOcupa, horaMadrid, inicioDiaMadrid, limites, mesValido, moverMes, nombreMes,
  porDia, rejillaMes, sumarDiasISO, textoHorario, type Elemento, type Horario,
} from "@/lib/calendario";
import { hoyISO, NOMBRE_AUSENCIA } from "@/lib/jornada";
import { calendarioActivo, citasEntre, type Cita } from "@/lib/outlook";
import { DOMINIO_PIN } from "@/lib/pin";
import { alcanceCentros, conPermiso } from "@/lib/usuario";
import { archivarFecha, borrarNota, fechaAMiOutlook, guardarFecha, guardarNota } from "./acciones";
import "./calendario.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendario · Grupo Trimodos" };

type Nota = Horario & { id: number; titulo: string; detalle: string | null; outlook_evento_id: string | null };
type Fecha = Horario & {
  id: number; titulo: string; detalle: string | null; enlace: string | null; lugar: string | null; alcance: "todos" | "centro" | "equipo";
  centro_id: number | null; centro: string | null; equipo_id: number | null; equipo: string | null; creado_por: string | null;
  autor: string | null; activo: boolean;
};
type Ausencia = { id: number; tipo: string; desde: string; hasta: string };
type Item = Elemento & (
  | { tipo: "nota"; nota: Nota }
  | { tipo: "fecha"; fecha: Fecha; enOutlook: boolean }
  | { tipo: "ausencia"; ausencia: Ausencia }
  | { tipo: "outlook"; cita: Cita });

const NOMBRE_TIPO = { nota: "Mi nota", fecha: "Fecha señalada", ausencia: "Aprobada", outlook: "Outlook" } as const;
const SEMANA = ["L", "M", "X", "J", "V", "S", "D"];
/** ¿La tabla o la función no existen todavía? (migración sin aplicar) */
const sinPreparar = (e: { code?: string } | null) => !!e && ["42P01", "42883", "PGRST202", "PGRST205"].includes(e.code ?? "");

/** Calendario: notas propias, fechas señaladas, vacaciones y ausencias aprobadas y, para quien entra con Microsoft, su
 *  Outlook. Mes en el ordenador y agenda por días en el móvil. La base de datos decide qué ve cada uno. */
export default async function PaginaCalendario({ searchParams }: {
  searchParams: Promise<{ mes?: string; ok?: string; error?: string; nueva?: string; dia?: string; editar?: string }>;
}) {
  const { supabase, uid, perfil, puede } = await conPermiso("calendario.usar", "calendario.publicar");
  const { mes: pedido, ok, error, nueva, dia: diaPedido, editar } = await searchParams;
  const hoy = hoyISO();
  const mes = mesValido(pedido, hoy);
  const rejilla = rejillaMes(mes);
  const delMes = diasDelMes(mes);
  const { desde, hasta } = limites(rejilla);
  const usar = puede("calendario.usar");
  const publicar = puede("calendario.publicar");
  const administra = puede("admin.usuarios");
  const conMicrosoft = calendarioActivo() && !!perfil.email && !perfil.email.endsWith(`@${DOMINIO_PIN}`);

  const [notasR, fechasR, ausenciasR, citas] = await Promise.all([
    supabase.from("calendario_notas").select("id,titulo,detalle,empieza,termina,todo_el_dia,outlook_evento_id")
      .eq("usuario_id", uid).lt("empieza", hasta.toISOString())
      .or(`termina.gte."${desde.toISOString()}",empieza.gte."${desde.toISOString()}"`).order("empieza").limit(500).returns<Nota[]>(),
    supabase.rpc("fechas_senaladas_entre", { desde: desde.toISOString(), hasta: hasta.toISOString(), archivadas: publicar }),
    supabase.from("ausencias").select("id,tipo,desde,hasta").eq("usuario_id", uid).eq("estado", "aprobada")
      .lte("desde", rejilla.at(-1)!).gte("hasta", rejilla[0]).returns<Ausencia[]>(),
    conMicrosoft ? citasEntre(uid, desde, hasta).catch(() => null) : null,
  ]);
  const preparado = !sinPreparar(notasR.error) && !sinPreparar(fechasR.error);
  const conOutlook = citas !== null;

  const enlaceMes = (m: string) => `/calendario?mes=${m}`;
  const cabecera = <div className="cal-cabecera">
    <h1>Calendario</h1>
    <nav className="cal-navegar" aria-label="Cambiar de mes">
      <Link className="btn pequeno" href={enlaceMes(moverMes(mes, -1))} aria-label="Mes anterior">‹ Anterior</Link>
      <Link className="btn pequeno" href={enlaceMes(hoy.slice(0, 7))}>Hoy</Link>
      <Link className="btn pequeno" href={enlaceMes(moverMes(mes, 1))} aria-label="Mes siguiente">Siguiente ›</Link>
    </nav>
  </div>;

  if (!preparado) {
    return <>
      <Cabecera nombre={perfil.nombre || perfil.email || ""} />
      <main className="contenido estrecho">
        <h1>Calendario</h1>
        <section className="panel"><p>El calendario todavía no está preparado. Lo activará la administración en breve.</p></section>
      </main>
    </>;
  }

  const notas = notasR.data ?? [];
  const fechas = (fechasR.data ?? []) as Fecha[];
  const ausencias = ausenciasR.data ?? [];

  // Lo que ya está copiado en su Outlook no se repite: la nota enlazada, la fecha con el mismo título y hora, y la
  // ausencia que la app apuntó al aprobarse.
  const mismo = (c: Cita, titulo: string, empieza: string) => c.asunto === titulo && !!c.empieza && Date.parse(c.empieza) === Date.parse(empieza);
  const enlazadas = new Set(notas.map((n) => n.outlook_evento_id).filter(Boolean));
  const fechasEnOutlook = new Set<number>();
  const visibles = (citas ?? []).filter((c) => {
    if (!c.empieza) return false;
    if (c.id && enlazadas.has(c.id)) return false;
    const f = fechas.find((x) => mismo(c, x.titulo, x.empieza));
    if (f) { fechasEnOutlook.add(f.id); return false; }
    if (notas.some((n) => mismo(c, n.titulo, n.empieza))) return false;
    return !ausencias.some((a) => mismo(c, `${NOMBRE_AUSENCIA[a.tipo] ?? "Ausencia"} (aprobada)`, inicioDiaMadrid(a.desde).toISOString()));
  });

  const items: Item[] = [
    ...notas.map((n): Item => ({ tipo: "nota", nota: n, clave: `nota-${n.id}`, titulo: n.titulo, empieza: n.empieza, termina: n.termina, todoElDia: n.todo_el_dia })),
    ...fechas.map((f): Item => ({ tipo: "fecha", fecha: f, enOutlook: fechasEnOutlook.has(f.id), clave: `fecha-${f.id}`, titulo: f.titulo,
      empieza: f.empieza, termina: f.termina, todoElDia: f.todo_el_dia })),
    ...ausencias.map((a): Item => ({ tipo: "ausencia", ausencia: a, clave: `ausencia-${a.id}`, titulo: NOMBRE_AUSENCIA[a.tipo] ?? "Ausencia",
      empieza: inicioDiaMadrid(a.desde).toISOString(), termina: inicioDiaMadrid(sumarDiasISO(a.hasta, 1)).toISOString(), todoElDia: true })),
    ...visibles.map((c, i): Item => ({ tipo: "outlook", cita: c, clave: `outlook-${c.id ?? i}`, titulo: c.asunto, empieza: c.empieza!,
      termina: c.termina, todoElDia: c.todoElDia })),
  ];
  const dias = porDia(items, rejilla);
  const gestiona = (f: Fecha) => publicar && (f.creado_por === uid || administra);

  // Formularios: nueva nota, nueva fecha señalada o editar una de las dos.
  const diaFormulario = diaPedido && /^\d{4}-\d{2}-\d{2}$/.test(diaPedido) ? diaPedido : delMes.includes(hoy) ? hoy : delMes[0];
  const [queEditar, idEditar] = (editar ?? "").split("-");
  const notaEditada = queEditar === "nota" ? notas.find((n) => String(n.id) === idEditar) : undefined;
  const fechaEditada = queEditar === "fecha" ? fechas.find((f) => String(f.id) === idEditar && gestiona(f)) : undefined;
  const abrirNota = usar && (nueva === "nota" || !!notaEditada);
  const abrirFecha = publicar && (nueva === "fecha" || !!fechaEditada);

  // Para quién puede publicar: todos, sus centros con «calendario.publicar» (todos si administra) y sus equipos.
  let centros: { id: number; nombre: string }[] = [], equipos: { id: number; nombre: string }[] = [];
  if (abrirFecha) {
    const [alcance, misEquipos] = await Promise.all([
      administra ? supabase.from("centros").select("id,nombre").order("nombre").then((r) => ({ centros: (r.data ?? []) as { id: number; nombre: string }[] }))
        : alcanceCentros(supabase, uid, perfil.es_admin, ["calendario.publicar"]),
      puede("equipos.crear") ? (() => {
        const q = supabase.from("equipos_trabajo").select("id,nombre").eq("activo", true).order("nombre");
        return (administra ? q : q.eq("creado_por", uid)).returns<{ id: number; nombre: string }[]>();
      })() : null,
    ]);
    centros = alcance.centros;
    equipos = misEquipos?.data ?? [];
  }

  const enlaceDia = (d: string) => `/calendario?mes=${mes}&nueva=nota&dia=${d}#formulario`;
  const campos = (h: Horario | undefined) => (h ? camposDe(h) : { fecha: diaFormulario, hora: "", fecha_fin: "", hora_fin: "", todo_el_dia: false });

  const horarioCampos = (prefijo: string, h: Horario | undefined) => {
    const c = campos(h);
    return <>
      <div className="cal-campos">
        <div><label htmlFor={`${prefijo}-fecha`}>Día</label>
          <input id={`${prefijo}-fecha`} name="fecha" type="date" required defaultValue={c.fecha} /></div>
        <div><label htmlFor={`${prefijo}-hora`}>Hora</label>
          <input id={`${prefijo}-hora`} name="hora" type="time" defaultValue={c.hora} /></div>
        <div><label htmlFor={`${prefijo}-hora_fin`}>Hasta las (opcional)</label>
          <input id={`${prefijo}-hora_fin`} name="hora_fin" type="time" defaultValue={c.hora_fin} /></div>
      </div>
      <label className="cal-marca"><input type="checkbox" name="todo_el_dia" defaultChecked={c.todo_el_dia} /> Todo el día (no hace falta la hora)</label>
      <details className="cal-varios-dias" open={!!c.fecha_fin}>
        <summary>Dura varios días</summary>
        <label htmlFor={`${prefijo}-fecha_fin`}>Último día</label>
        <input id={`${prefijo}-fecha_fin`} name="fecha_fin" type="date" defaultValue={c.fecha_fin} />
      </details>
    </>;
  };

  const formularioNota = <section className="panel" id="formulario">
    <h2>{notaEditada ? "Cambiar la nota" : "Apuntar una nota"}</h2>
    <p className="hint">Solo la ves tú.</p>
    <form action={guardarNota}>
      <input type="hidden" name="mes" value={mes} />
      {notaEditada && <input type="hidden" name="id" value={notaEditada.id} />}
      <label htmlFor="nota-titulo">Qué quieres apuntar</label>
      <input id="nota-titulo" name="titulo" required maxLength={120} defaultValue={notaEditada?.titulo ?? ""} placeholder="Ej.: Llevar el camión al taller" />
      {horarioCampos("nota", notaEditada)}
      <label htmlFor="nota-detalle">Detalle (opcional)</label>
      <textarea id="nota-detalle" name="detalle" maxLength={500} rows={3} defaultValue={notaEditada?.detalle ?? ""} />
      {conOutlook && !notaEditada && <label className="cal-marca"><input type="checkbox" name="outlook" /> Añadir también a mi Outlook</label>}
      {conOutlook && notaEditada?.outlook_evento_id && <p className="hint">Los cambios también se guardan en tu Outlook.</p>}
      <BotonCalendario className="btn primario grande ancho">{notaEditada ? "Guardar la nota" : "Apuntar"}</BotonCalendario>
    </form>
    <Link className="btn ancho" href={enlaceMes(mes)} style={{ marginTop: 10 }}>Cancelar</Link>
  </section>;

  const formularioFecha = <section className="panel" id="formulario">
    <h2>{fechaEditada ? "Cambiar la fecha señalada" : "Publicar una fecha señalada"}</h2>
    <p className="hint">Una comida, un webinar, una formación… La verán las personas que elijas.</p>
    <form action={guardarFecha}>
      <input type="hidden" name="mes" value={mes} />
      {fechaEditada && <input type="hidden" name="id" value={fechaEditada.id} />}
      <label htmlFor="fecha-titulo">Título</label>
      <input id="fecha-titulo" name="titulo" required maxLength={120} defaultValue={fechaEditada?.titulo ?? ""} placeholder="Ej.: Comida de Navidad" />
      <label htmlFor="fecha-para">Para quién</label>
      <select id="fecha-para" name="para" required defaultValue={fechaEditada
        ? fechaEditada.alcance === "todos" ? "todos" : `${fechaEditada.alcance}:${fechaEditada.centro_id ?? fechaEditada.equipo_id}` : "todos"}>
        <option value="todos">Todas las personas de la empresa</option>
        {centros.length > 0 && <optgroup label="Un centro">
          {centros.map((c) => <option key={c.id} value={`centro:${c.id}`}>{c.nombre}</option>)}
        </optgroup>}
        {equipos.length > 0 && <optgroup label="Un equipo">
          {equipos.map((e) => <option key={e.id} value={`equipo:${e.id}`}>{e.nombre}</option>)}
        </optgroup>}
      </select>
      {horarioCampos("fecha", fechaEditada)}
      <label htmlFor="fecha-lugar">Lugar (opcional)</label>
      <input id="fecha-lugar" name="lugar" maxLength={120} defaultValue={fechaEditada?.lugar ?? ""} placeholder="Ej.: Comedor del centro" />
      <label htmlFor="fecha-enlace">Enlace (opcional)</label>
      <input id="fecha-enlace" name="enlace" type="url" maxLength={500} defaultValue={fechaEditada?.enlace ?? ""} placeholder="https://…" />
      <label htmlFor="fecha-detalle">Detalle (opcional)</label>
      <textarea id="fecha-detalle" name="detalle" maxLength={1000} rows={3} defaultValue={fechaEditada?.detalle ?? ""} />
      <BotonCalendario className="btn primario grande ancho">{fechaEditada ? "Guardar cambios" : "Publicar"}</BotonCalendario>
    </form>
    <Link className="btn ancho" href={enlaceMes(mes)} style={{ marginTop: 10 }}>Cancelar</Link>
  </section>;

  const paraQuien = (f: Fecha) => f.alcance === "todos" ? "Todas las personas"
    : f.alcance === "centro" ? `Centro ${f.centro ?? ""}`.trim() : `Equipo ${f.equipo ?? ""}`.trim();

  const elemento = (it: Item, dia: string) => {
    // Las acciones, solo el primer día que se ve (si dura varios días, no se repiten).
    const primero = diasQueOcupa(it)[0] < delMes[0] ? delMes[0] : diasQueOcupa(it)[0];
    const acciones = dia === primero;
    return <li key={it.clave} className={`cal-item cal-${it.tipo}`}>
      <div className="cal-item-cabecera">
        <span className="cal-hora">{textoHorario(it, dia)}</span>
        <span className="cal-tipo">{it.tipo === "ausencia" ? `${it.titulo} · aprobada` : NOMBRE_TIPO[it.tipo]}</span>
        {it.tipo === "fecha" && !it.fecha.activo && <span className="etiqueta pronto">Archivada</span>}
        {((it.tipo === "nota" && it.nota.outlook_evento_id) || (it.tipo === "fecha" && it.enOutlook)) && conOutlook && <span className="etiqueta ok">En tu Outlook</span>}
      </div>
      {it.tipo !== "ausencia" && <p className="cal-titulo">{it.titulo}</p>}

      {it.tipo === "nota" && <>
        {it.nota.detalle && <p className="cal-detalle">{it.nota.detalle}</p>}
        {acciones && <div className="cal-acciones">
          <Link className="btn pequeno" href={`/calendario?mes=${mes}&editar=nota-${it.nota.id}#formulario`}>Cambiar</Link>
          <details className="cal-borrar"><summary className="btn pequeno">Borrar</summary>
            <form action={borrarNota}>
              <input type="hidden" name="mes" value={mes} /><input type="hidden" name="id" value={it.nota.id} />
              {conOutlook && it.nota.outlook_evento_id && <label className="cal-marca"><input type="checkbox" name="tambien_outlook" defaultChecked /> Borrarla también de mi Outlook</label>}
              <BotonCalendario className="btn pequeno peligro">Sí, borrar la nota</BotonCalendario>
            </form>
          </details>
        </div>}
      </>}

      {it.tipo === "fecha" && <>
        {it.fecha.lugar && <p className="cal-detalle"><Icono nombre="ubicacion" size={15} /> {it.fecha.lugar}</p>}
        {it.fecha.detalle && <p className="cal-detalle">{it.fecha.detalle}</p>}
        {it.fecha.enlace && <p className="cal-detalle"><a href={it.fecha.enlace} target="_blank" rel="noopener noreferrer">Abrir el enlace</a></p>}
        <p className="hint cal-quien">Para: {paraQuien(it.fecha)}{it.fecha.autor ? ` · Publicada por ${it.fecha.creado_por === uid ? "ti" : it.fecha.autor}` : ""}</p>
        {acciones && <div className="cal-acciones">
          {conOutlook && it.fecha.activo && !it.enOutlook && <form action={fechaAMiOutlook}>
            <input type="hidden" name="mes" value={mes} /><input type="hidden" name="id" value={it.fecha.id} />
            <BotonCalendario className="btn pequeno">Añadir a mi Outlook</BotonCalendario>
          </form>}
          {gestiona(it.fecha) && it.fecha.activo && <Link className="btn pequeno" href={`/calendario?mes=${mes}&editar=fecha-${it.fecha.id}#formulario`}>Cambiar</Link>}
          {gestiona(it.fecha) && <form action={archivarFecha}>
            <input type="hidden" name="mes" value={mes} /><input type="hidden" name="id" value={it.fecha.id} />
            <input type="hidden" name="activo" value={it.fecha.activo ? "false" : "true"} />
            <BotonCalendario className="btn pequeno">{it.fecha.activo ? "Archivar" : "Recuperar"}</BotonCalendario>
          </form>}
        </div>}
      </>}

      {it.tipo === "ausencia" && acciones && puede("ausencias.pedir") && <Link className="cal-enlace" href="/ausencias">Ver mis ausencias</Link>}

      {it.tipo === "outlook" && <>
        {it.cita.lugar && <p className="cal-detalle"><Icono nombre="ubicacion" size={15} /> {it.cita.lugar}</p>}
        {acciones && it.cita.enlace && <a className="cal-enlace" href={it.cita.enlace} target="_blank" rel="noopener noreferrer">Abrir en Outlook</a>}
      </>}
    </li>;
  };

  const conAlgo = delMes.filter((d) => (dias.get(d)?.length ?? 0) > 0 || d === hoy);

  return (
    <>
      <Cabecera nombre={perfil.nombre || perfil.email || ""} />
      <main className="contenido cal-contenido">
        {cabecera}
        {ok && <p className="aviso" role="status">{ok}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {(notasR.error || fechasR.error || ausenciasR.error) && <p className="error" role="alert">No se ha podido consultar todo el calendario, incluidas tus ausencias. Recarga la página.</p>}

        {notas.length >= 500 && <p className="aviso" role="status">Este mes tiene muchas notas: se muestran las primeras 500. La agenda puede estar incompleta.</p>}

        <div className="cal-botones">
          {usar && !abrirNota && <Link className="btn primario" href={`/calendario?mes=${mes}&nueva=nota#formulario`}>Apuntar una nota</Link>}
          {publicar && !abrirFecha && <Link className="btn" href={`/calendario?mes=${mes}&nueva=fecha#formulario`}>Publicar una fecha señalada</Link>}
        </div>
        {abrirNota && formularioNota}
        {!abrirNota && abrirFecha && formularioFecha}

        <h2 className="cal-mes-nombre">{nombreMes(mes)}</h2>
        <ul className="cal-leyenda" aria-label="Leyenda">
          {usar && <li className="cal-nota">Mis notas</li>}
          <li className="cal-fecha">Fechas señaladas</li>
          <li className="cal-ausencia">Vacaciones y ausencias</li>
          {conOutlook && <li className="cal-outlook">Outlook</li>}
        </ul>

        {/* Ordenador: el mes en cuadrícula. Cada día lleva a su detalle de abajo. */}
        <div className="cal-mes" aria-label={`Calendario de ${nombreMes(mes)}`}>
          {SEMANA.map((d) => <div key={d} className="cal-semana" aria-hidden="true">{d}</div>)}
          {rejilla.map((d) => {
            const lista = dias.get(d) ?? [];
            const fuera = !d.startsWith(mes);
            return <div key={d} className={`cal-celda${fuera ? " fuera" : ""}${d === hoy ? " hoy" : ""}`}>
              <div className="cal-celda-top">
                {fuera ? <span className="cal-numero">{Number(d.slice(8))}</span>
                  : <a className="cal-numero" href={!lista.length && d !== hoy && usar ? enlaceDia(d) : `#dia-${d}`} aria-label={diaLargo(d)}>{Number(d.slice(8))}</a>}
                {usar && !fuera && <Link className="cal-mas" href={enlaceDia(d)} aria-label={`Apuntar una nota el ${diaLargo(d)}`}>+</Link>}
              </div>
              {lista.slice(0, 3).map((it) => <a key={it.clave} href={fuera ? undefined : `#dia-${d}`} className={`cal-chip cal-${it.tipo}`}>
                {!it.todoElDia && diasQueOcupa(it)[0] === d ? `${horaMadrid(it.empieza)} ` : ""}{it.titulo}</a>)}
              {lista.length > 3 && <span className="cal-chip-mas">y {lista.length - 3} más</span>}
            </div>;
          })}
        </div>

        {/* Móvil (y detalle en el ordenador): agenda por días, solo los que tienen algo y hoy. */}
        <section className="cal-agenda" aria-label={`Agenda de ${nombreMes(mes)}`}>
          {conAlgo.length === 0 && <p className="panel hint">No hay nada en {nombreMes(mes)}.</p>}
          {conAlgo.map((d) => <div key={d} id={`dia-${d}`} className={`cal-dia${d === hoy ? " hoy" : ""}`}>
            <div className="cal-dia-cabecera">
              <h3>{d === hoy ? "Hoy · " : ""}{diaLargo(d)}</h3>
              {usar && <Link className="btn pequeno" href={enlaceDia(d)}>Apuntar</Link>}
            </div>
            {(dias.get(d) ?? []).length === 0 ? <p className="hint">Nada apuntado.</p>
              : <ul className="cal-lista">{(dias.get(d) ?? []).map((it) => elemento(it, d))}</ul>}
          </div>)}
        </section>
        <p className="hint cal-pie">Del {diaCorto(delMes[0])} al {diaCorto(delMes.at(-1)!)}. Horas de Madrid.</p>
      </main>
    </>
  );
}
