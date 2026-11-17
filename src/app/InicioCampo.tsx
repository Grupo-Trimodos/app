import { Suspense } from "react";
import MiOrganizacion from "./MiOrganizacion";
import Link from "next/link";
import RelojJornada from "./RelojJornada";
import { leerFichajesJornada } from "@/lib/jornadas-servidor";
import EstadoOdoo from "./EstadoOdoo";
import Icono, { ICONOS_AREA } from "./Icono";
import { reintentarOdoo } from "./fichaje/acciones";
import { confirmarDotacion } from "./ropa/acciones";
import {
  calcularJornada, hora, inicioSemana,
  type Fichaje,
} from "@/lib/jornada";
import { misPendientes } from "@/lib/pendientes";
import { AREAS } from "@/lib/permisos";
import { CLASE_DOTACION, ESTADO_DOTACION, nombreTemporada, tallasQueFaltan, temporadaActual, textoKit, type LineaKit, type Tallas } from "@/lib/ropa";
import { usuarioActual } from "@/lib/usuario";

/**
 * Inicio de chóferes y operarios: UNA pantalla, sin menú, pensada para el móvil y la cabina. Arriba fichar (botón
 * grande); después lo que tiene pendiente, su ropa de temporada y, solo si su puesto lo tiene, unos pocos accesos.
 * Qué aparece lo deciden los permisos de sus perfiles, nunca su nombre.
 */
export default async function InicioCampo({ nombre, ok, error }: { nombre: string; ok?: string; error?: string }) {
  const { supabase, uid, esDeSuPuesto, puede } = await usuarioActual();
  const temporada = temporadaActual();
  const conRopa = esDeSuPuesto("ropa.pedir");
  if (conRopa) await supabase.rpc("preparar_dotaciones");
  const semana = inicioSemana();
  const [registro, camion, dotacion, tallas, { tareas }] = await Promise.all([
    esDeSuPuesto("fichaje.fichar", "chofer.usar") ? leerFichajesJornada(supabase, uid, semana) : null,
    esDeSuPuesto("chofer.usar") ? supabase.from("asignaciones").select("vehiculos(matricula)").eq("usuario_id", uid).is("fin", null)
      .maybeSingle<{ vehiculos: { matricula: string } | null }>() : null,
    conRopa ? supabase.from("ropa_dotaciones").select("id,prendas,estado,entregado_en").eq("usuario_id", uid).eq("temporada", temporada)
      .maybeSingle<{ id: number; prendas: LineaKit[]; estado: string; entregado_en: string | null }>() : null,
    conRopa ? supabase.from("tallas_ropa").select("tallas").eq("usuario_id", uid).maybeSingle<{ tallas: Tallas }>() : null,
    misPendientes(),
  ]);

  const fichajes = (registro?.data ?? []) as Fichaje[];
  const resumen = calcularJornada(fichajes);
  const { estado } = resumen;
  const ultimo = fichajes.at(-1);
  const sinEnviar = fichajes.some((f) => ["pendiente", "error", "sin_empleado"].includes(f.odoo_estado));
  const matricula = camion?.data?.vehiculos?.matricula;
  const dot = dotacion?.data ?? null;
  const misTallas = tallas?.data?.tallas ?? null;
  const faltanTallas = dot ? tallasQueFaltan(dot.prendas, misTallas) : [];
  // Lo que tiene que resolver (si además es responsable) y su documentación: como avisos arriba.
  const avisos = tareas.filter((t) => t.cantidad);

  const ahora = new Date();
  const h = Number(ahora.toLocaleString("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }));
  const saludo = h < 13 ? "Buenos días" : h < 21 ? "Buenas tardes" : "Buenas noches";
  const hoyTexto = ahora.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long" });
  const accesos = [
    esDeSuPuesto("chofer.usar") && { href: "/chofer", icono: "camion", texto: "Mi camión y mis horas" },
    esDeSuPuesto("deca.usar") && { href: "/deca/", icono: "documento", texto: "Orden de transporte (DECA)", completa: true },
    esDeSuPuesto("ausencias.pedir") && { href: "/ausencias", icono: "calendario", texto: "Vacaciones y permisos" },
    esDeSuPuesto("documentos.propios") && { href: "/documentos", icono: "documento", texto: "Mi documentación" },
    esDeSuPuesto("incidencias.reportar") && { href: "/incidencias", icono: "aviso", texto: "Avisar de una incidencia" },
    esDeSuPuesto("fichaje.fichar") && { href: "/fichaje", icono: "reloj", texto: "Mis fichajes" },
  ].filter((a): a is { href: string; icono: string; texto: string; completa?: boolean } => !!a);
  // Lo que gestiona además de su puesto (p. ej. un operario que es Responsable: «Mi equipo»). Sale de sus permisos de
  // gestión, nunca del nombre del perfil; sin menú, es su única forma de llegar.
  const gestion = AREAS.filter((a) => a.permisos.some((p) => !p.de_puesto && puede(p.id)))
    .map((a) => ({ href: a.ruta, icono: ICONOS_AREA[a.id] ?? "equipo", texto: a.nombre }));

  return <div className="campo">
    <div className="campo-saludo">
      <h1>{saludo}{nombre ? `, ${nombre.split(/[ @]/)[0]}` : ""}</h1>
      <p><span>{hoyTexto}</span></p>
    </div>
    {ok && <p className="aviso" role="status">{ok}</p>}
    {error && <p className="error" role="alert">{error}</p>}

    {registro && <section className={`campo-jornada ${estado}`} aria-labelledby="campo-jornada-t">
      <h2 id="campo-jornada-t" className="sr-only">Mi jornada</h2>
      <RelojJornada fichajes={fichajes} instante={ahora.toISOString()} error={!!registro.error} permitirFichar={esDeSuPuesto("fichaje.fichar")} volver="/" />
      {esDeSuPuesto("chofer.usar") && <Link href="/chofer" className={`campo-camion ${matricula ? "" : "falta"}`}>
        <Icono nombre="camion" size={20} /><span>{matricula ? <>Camión <b>{matricula}</b></> : "Confirma tu camión al subir a la cabina"}</span>
        <Icono nombre="flecha" size={18} /></Link>}
      {!esDeSuPuesto("fichaje.fichar") && <Link className="btn ancho grande primario" href="/chofer">Ir a mi camión</Link>}
      {ultimo && <p className="campo-jornada-ultimo">Último fichaje a las {hora(ultimo.momento)} <EstadoOdoo estado={ultimo.odoo_estado} error={ultimo.odoo_error} /></p>}
      {sinEnviar && <form action={reintentarOdoo}><input type="hidden" name="volver" value="/" />
        <button className="btn ancho pequeno campo-secundario">Reintentar envío a Odoo</button></form>}
    </section>}

    <Suspense fallback={null}><MiOrganizacion /></Suspense>

    {avisos.length > 0 && <section className="campo-avisos" aria-label="Tienes pendiente">
      {avisos.map((t) => <Link key={t.id} href={t.href} className="campo-aviso">
        <Icono nombre={t.icono} size={22} /><span><b>{t.titulo}</b><small>{t.detalle}</small></span>
        <strong>{t.cantidad}</strong></Link>)}
    </section>}

    {conRopa && <section className="campo-tarjeta" aria-labelledby="campo-ropa-t">
      <div className="campo-tarjeta-cabecera">
        <h2 id="campo-ropa-t"><Icono nombre="ropa" size={20} />Ropa de {nombreTemporada(temporada).toLowerCase()}</h2>
        {dot && <span className={`etiqueta ${CLASE_DOTACION[dot.estado]}`}>{ESTADO_DOTACION[dot.estado]}</span>}
      </div>
      {!dot ? <p className="hint">Tu puesto no tiene ropa de temporada.</p> : <>
        <p className="campo-ropa-lista">{dot.prendas.map((l) => textoKit(l, misTallas)).join(" · ")}</p>
        {dot.estado === "entregada" ? <form action={confirmarDotacion}>
          <input type="hidden" name="id" value={dot.id} /><input type="hidden" name="volver" value="/" />
          <button className="btn primario ancho grande">Sí, ya tengo mi ropa</button>
        </form> : faltanTallas.length > 0 ? <Link href="/ropa" className="btn primario ancho">Apuntar mis tallas</Link> : null}
      </>}
      <Link href="/ropa" className="campo-enlace">Mis tallas y cambios de ropa<Icono nombre="flecha" size={16} /></Link>
    </section>}

    {gestion.length > 0 && <nav className="campo-accesos" aria-label="Lo que gestionas">
      {gestion.map((a) => <Link key={a.href} href={a.href}><Icono nombre={a.icono} size={22} /><span>{a.texto}</span><Icono nombre="flecha" size={18} /></Link>)}
    </nav>}

    {accesos.length > 0 && <nav className="campo-accesos" aria-label="Más cosas">
      {accesos.map((a) => {
        const dentro = <><Icono nombre={a.icono} size={22} /><span>{a.texto}</span><Icono nombre="flecha" size={18} /></>;
        return a.completa ? <a key={a.href} href={a.href}>{dentro}</a> : <Link key={a.href} href={a.href}>{dentro}</Link>;
      })}
    </nav>}
  </div>;
}
