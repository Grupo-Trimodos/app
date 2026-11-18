import { Suspense } from "react";
import PedirTelefono from "./PedirTelefono";
import TarjetaViajes from "./TarjetaViajes";
import ProximoCalendario from "./calendario/Proximo";
import Link from "next/link";
import RelojJornada from "./RelojJornada";
import { leerFichajesJornada } from "@/lib/jornadas-servidor";
import Icono, { ICONOS_AREA } from "./Icono";
import { confirmarDotacion } from "./ropa/acciones";
import { diaYMes, hoyISO, inicioSemana, rangoDias, type Fichaje } from "@/lib/jornada";
import { misPendientes } from "@/lib/pendientes";
import { AREAS } from "@/lib/permisos";
import { CLASE_DOTACION, ESTADO_DOTACION, nombreTemporada, tallasQueFaltan, temporadaActual, textoKit, type LineaKit, type Tallas } from "@/lib/ropa";
import { usuarioActual } from "@/lib/usuario";

type Ausencia = { id: number; tipo: string; desde: string; hasta: string; estado: "pendiente" | "aprobada" };
const APROBADA: Record<string, string> = {
  vacaciones: "Vacaciones aprobadas", asuntos_propios: "Asuntos propios aprobados", medico: "Permiso de médico aprobado", otro: "Permiso aprobado",
};
const PEDIDA: Record<string, string> = {
  vacaciones: "Vacaciones", asuntos_propios: "Asuntos propios", medico: "Permiso de médico", otro: "Permiso",
};
/** Áreas que ya están en la barra de abajo (BarraCampo): no se repiten en las listas del inicio. */
const EN_LA_BARRA = new Set(["fichaje", "ausencias", "automatizaciones"]);

/**
 * Inicio de chóferes y operarios: UNA pantalla, pensada para el móvil y la cabina. Arriba la jornada y el botón de
 * fichar; debajo, solo si los hay, sus avisos (vacaciones, lo pendiente, su ropa) y unos pocos accesos. Las secciones
 * principales están en la barra de abajo. Nada de Odoo: el trabajador no lo ve. Lo que aparece lo deciden los permisos
 * de sus perfiles, nunca su nombre.
 */
export default async function InicioCampo({ nombre, ok, error }: { nombre: string; ok?: string; error?: string }) {
  const { supabase, uid, esDeSuPuesto, puede } = await usuarioActual();
  const temporada = temporadaActual();
  const conRopa = esDeSuPuesto("ropa.pedir");
  if (conRopa) await supabase.rpc("preparar_dotaciones");
  const semana = inicioSemana();
  const hoy = hoyISO();
  const [registro, camion, dotacion, tallas, ausencias, { tareas }] = await Promise.all([
    esDeSuPuesto("fichaje.fichar", "chofer.usar") ? leerFichajesJornada(supabase, uid, semana) : null,
    esDeSuPuesto("chofer.usar") ? supabase.from("asignaciones").select("vehiculos(matricula)").eq("usuario_id", uid).is("fin", null)
      .maybeSingle<{ vehiculos: { matricula: string } | null }>() : null,
    conRopa ? supabase.from("ropa_dotaciones").select("id,prendas,estado,entregado_en").eq("usuario_id", uid).eq("temporada", temporada)
      .maybeSingle<{ id: number; prendas: LineaKit[]; estado: string; entregado_en: string | null }>() : null,
    conRopa ? supabase.from("tallas_ropa").select("tallas").eq("usuario_id", uid).maybeSingle<{ tallas: Tallas }>() : null,
    // Sus solicitudes que aún no han pasado: las que esperan respuesta y las aprobadas que vienen.
    esDeSuPuesto("ausencias.pedir") ? supabase.from("ausencias").select("id,tipo,desde,hasta,estado").eq("usuario_id", uid)
      .in("estado", ["pendiente", "aprobada"]).gte("hasta", hoy).order("desde").limit(6).returns<Ausencia[]>() : null,
    misPendientes(),
  ]);

  const fichajes = (registro?.data ?? []) as Fichaje[];
  const matricula = camion?.data?.vehiculos?.matricula;
  const dot = dotacion?.data ?? null;
  const misTallas = tallas?.data?.tallas ?? null;
  const faltanTallas = dot ? tallasQueFaltan(dot.prendas, misTallas) : [];
  // Lo que tiene que resolver (si además es responsable) y su documentación: como avisos.
  const avisos = tareas.filter((t) => t.cantidad);
  const lista = ausencias?.data ?? [];
  const avisosVacaciones = [
    ...lista.filter((a) => a.estado === "pendiente").slice(0, 2).map((a) => ({
      id: a.id, texto: `${PEDIDA[a.tipo] ?? "Permiso"} ${rangoDias(a.desde, a.hasta)}`, detalle: "Esperando la respuesta de tu responsable", aprobada: false })),
    ...lista.filter((a) => a.estado === "aprobada").slice(0, 1).map((a) => ({
      id: a.id, aprobada: true, detalle: a.desde <= hoy ? "En curso" : "Aprobado por tu responsable",
      texto: a.desde <= hoy ? `${APROBADA[a.tipo] ?? "Permiso aprobado"} hasta el ${diaYMes(a.hasta)}`
        : `${APROBADA[a.tipo] ?? "Permiso aprobado"} ${rangoDias(a.desde, a.hasta)}` })),
  ];

  const ahora = new Date();
  const h = Number(ahora.toLocaleString("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }));
  const saludo = h < 13 ? "Buenos días" : h < 21 ? "Buenas tardes" : "Buenas noches";
  const hoyTexto = ahora.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long" });
  const accesos = [
    esDeSuPuesto("deca.usar") && { href: "/deca/", icono: "documento", texto: "Órdenes de transporte", completa: true },
    esDeSuPuesto("chofer.usar") && { href: "/chofer", icono: "camion", texto: "Mi camión y mis horas" },
    esDeSuPuesto("documentos.propios") && { href: "/documentos", icono: "documento", texto: "Mi documentación" },
    esDeSuPuesto("incidencias.reportar") && { href: "/incidencias", icono: "aviso", texto: "Avisar de una incidencia" },
    esDeSuPuesto("equipos.ver") && !puede("equipos.crear") && { href: "/equipos", icono: "equipo", texto: "Mis equipos" },
    esDeSuPuesto("calendario.usar") && !puede("calendario.publicar") && { href: "/calendario", icono: "calendario", texto: "Mi calendario" },
  ].filter((a): a is { href: string; icono: string; texto: string; completa?: boolean } => !!a);
  // Lo que gestiona además de su puesto (p. ej. un operario que es Responsable: «Mi equipo»). Sale de sus permisos de
  // gestión, nunca del nombre del perfil; sin menú, es su única forma de llegar.
  const gestion = AREAS.filter((a) => !EN_LA_BARRA.has(a.id) && a.permisos.some((p) => !p.de_puesto && puede(p.id)))
    .map((a) => ({ href: a.ruta, icono: ICONOS_AREA[a.id] ?? "equipo", texto: a.nombre }));

  return <div className="campo">
    <div className="campo-saludo">
      <h1>{saludo}{nombre ? `, ${nombre.split(/[ @]/)[0]}` : ""}</h1>
      <p><span>{hoyTexto}</span></p>
    </div>
    {ok && <p className="aviso" role="status">{ok}</p>}
    {error && <p className="error" role="alert">{error}</p>}

    {registro && <RelojJornada fichajes={fichajes} instante={ahora.toISOString()} error={!!registro.error}
      permitirFichar={esDeSuPuesto("fichaje.fichar")}>
      {esDeSuPuesto("chofer.usar") && <Link href="/chofer" className={`campo-camion ${matricula ? "" : "falta"}`}>
        <Icono nombre="camion" size={22} /><span>{matricula ? <>Camión <b>{matricula}</b></> : "Confirma tu camión al subir a la cabina"}</span>
        <Icono nombre="flecha" size={20} /></Link>}
      {!esDeSuPuesto("fichaje.fichar") && <Link className="btn ancho primario campo-principal" href="/chofer">Ir a mi camión</Link>}
    </RelojJornada>}

    {avisosVacaciones.length > 0 && <section className="campo-avisos" aria-label="Tus vacaciones">
      {avisosVacaciones.map((a) => <Link key={a.id} href="/ausencias" className={`campo-aviso ${a.aprobada ? "bien" : ""}`}>
        <Icono nombre={a.aprobada ? "check" : "calendario"} size={24} /><span><b>{a.texto}</b><small>{a.detalle}</small></span>
        <Icono nombre="flecha" size={20} /></Link>)}
    </section>}

    {/* Lo próximo de su calendario (no sale nada si no hay o si el calendario aún no está preparado). */}
    {esDeSuPuesto("calendario.usar") && <Suspense fallback={null}><ProximoCalendario /></Suspense>}

    {/* La orden en curso y el paso que toca: en su propio Suspense, debajo del fichaje, para no moverlo al cargar. */}
    {esDeSuPuesto("viajes.usar") && <Suspense fallback={null}><TarjetaViajes /></Suspense>}

    {avisos.length > 0 && <section className="campo-avisos" aria-label="Tienes pendiente">
      {avisos.map((t) => <Link key={t.id} href={t.href} className="campo-aviso">
        <Icono nombre={t.icono} size={24} /><span><b>{t.titulo}</b><small>{t.detalle}</small></span>
        <strong>{t.cantidad}</strong></Link>)}
    </section>}

    {/* Solo mientras no haya dado su móvil. Debajo del fichaje: al cargar no empuja el botón. */}
    <Suspense fallback={null}><PedirTelefono volver="/" /></Suspense>

    {accesos.length > 0 && <nav className="campo-accesos" aria-label="Más cosas">
      {accesos.map((a) => {
        const dentro = <><Icono nombre={a.icono} size={24} /><span>{a.texto}</span><Icono nombre="flecha" size={20} /></>;
        // Órdenes de transporte (DECA) es una aplicación aparte: necesita una navegación completa.
        return a.completa ? <a key={a.href} href={a.href}>{dentro}</a> : <Link key={a.href} href={a.href}>{dentro}</Link>;
      })}
    </nav>}

    {conRopa && <section className="campo-tarjeta" aria-labelledby="campo-ropa-t">
      <div className="campo-tarjeta-cabecera">
        <h2 id="campo-ropa-t"><Icono nombre="ropa" size={22} />Ropa de {nombreTemporada(temporada).toLowerCase()}</h2>
        {dot && <span className={`etiqueta ${CLASE_DOTACION[dot.estado]}`}>{ESTADO_DOTACION[dot.estado]}</span>}
      </div>
      {!dot ? <p className="hint">Tu puesto no tiene ropa de temporada.</p> : <>
        <p className="campo-ropa-lista">{dot.prendas.map((l) => textoKit(l, misTallas)).join(" · ")}</p>
        {dot.estado === "entregada" ? <form action={confirmarDotacion}>
          <input type="hidden" name="id" value={dot.id} /><input type="hidden" name="volver" value="/" />
          <button className="btn primario ancho grande">Sí, ya tengo mi ropa</button>
        </form> : faltanTallas.length > 0 ? <Link href="/ropa" className="btn primario ancho">Apuntar mis tallas</Link> : null}
      </>}
      <Link href="/ropa" className="campo-enlace">Mis tallas y cambios de ropa<Icono nombre="flecha" size={18} /></Link>
    </section>}

    {gestion.length > 0 && <nav className="campo-accesos" aria-label="Lo que gestionas">
      {gestion.map((a) => <Link key={a.href} href={a.href}><Icono nombre={a.icono} size={24} /><span>{a.texto}</span><Icono nombre="flecha" size={20} /></Link>)}
    </nav>}
  </div>;
}
