import Link from "next/link";
import Cabecera from "../../Cabecera";
import Icono from "../../Icono";
import Imprimir from "./Imprimir";
import { leerFichajesJornada } from "@/lib/jornadas-servidor";
import { conPermiso } from "@/lib/usuario";
import {
  diaLargo, diaMadrid, diaSemana, duracionCorta, duracionMs, horaCorta, madridAInstante, periodoPedido, registroDeJornadas,
  sumarDias, textoCorreccion, ZONA,
} from "@/lib/jornada";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi registro de jornada · Grupo Trimodos" };

const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Registro de jornada del mes, listo para imprimir o guardar como PDF (con el cuadro de imprimir del navegador: sin
 * librerías). Cada día con su entrada, salida, pausas y total; lo que anotó el responsable, con su motivo, al pie.
 */
export default async function RegistroImprimible({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { supabase, uid, perfil } = await conPermiso("fichaje.fichar");
  const { mes } = await searchParams;
  const ahora = new Date();
  const hoy = diaMadrid(ahora);
  const periodo = periodoPedido({ mes: mes ?? hoy.slice(0, 7) }, ahora);
  const [{ data: fichajes, error }, { data: perfiles }] = await Promise.all([
    leerFichajesJornada(supabase, uid, madridAInstante(`${periodo.desde}T00:00`)!),
    supabase.from("usuario_perfil").select("centros(nombre)").eq("usuario_id", uid)
      .returns<{ centros: { nombre: string } | null }[]>(),
  ]);
  const centros = [...new Set((perfiles ?? []).flatMap((p) => (p.centros ? [p.centros.nombre] : [])))];
  const registro = registroDeJornadas(fichajes, periodo.desde, periodo.hasta, ahora);
  const porDia = new Map(registro.dias.map((d) => [d.dia, d]));
  const ultimo = periodo.hasta < hoy ? periodo.hasta : hoy;
  const dias: string[] = [];
  for (let d = periodo.desde; d <= ultimo; d = sumarDias(d, 1)) dias.push(d);
  // Lo que anotó el responsable, con su motivo, al pie (y un asterisco en la fila).
  const notas = registro.dias.flatMap((d) => d.jornadas.flatMap((j) =>
    j.correcciones.map((c) => `${mayuscula(diaLargo(d.dia))}: ${textoCorreccion(c)}`)));
  const generado = ahora.toLocaleString("es-ES", { timeZone: ZONA, day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
  const nombre = perfil.nombre || perfil.codigo || "";

  return <>
    <Cabecera nombre={nombre} />
    <main className="contenido estrecho registro">
      <div className="registro-mandos no-imprimir">
        <Link href={`/fichaje?mes=${periodo.desde.slice(0, 7)}`} className="campo-enlace"><Icono nombre="flecha" size={18} />Volver a mis fichajes</Link>
        <div className="campo-periodo">
          <Link href={`/fichaje/registro?mes=${periodo.anterior}`} className="campo-periodo-btn" aria-label="Mes anterior"><Icono nombre="flecha" size={24} /></Link>
          <p><b>{periodo.titulo}</b></p>
          {periodo.siguiente ? <Link href={`/fichaje/registro?mes=${periodo.siguiente}`} className="campo-periodo-btn siguiente" aria-label="Mes siguiente">
            <Icono nombre="flecha" size={24} /></Link> : <span className="campo-periodo-btn vacio" aria-hidden="true" />}
        </div>
        {!error && <Imprimir />}
        <p className="hint">Se abre el cuadro de imprimir del móvil o del ordenador. Para tener el archivo, elige «Guardar como PDF».</p>
      </div>

      <article className="registro-hoja">
        <header>
          <p className="registro-marca"><img src="/deca/img/trimodos.png" alt="Grupo Trimodos" width={210} height={45} /></p>
          <h1>Registro de jornada</h1>
          <dl>
            <div><dt>Persona</dt><dd>{nombre || "—"}</dd></div>
            {perfil.codigo && perfil.codigo !== nombre && <div><dt>Código</dt><dd>{perfil.codigo}</dd></div>}
            {centros.length > 0 && <div><dt>{centros.length === 1 ? "Centro" : "Centros"}</dt><dd>{centros.join(", ")}</dd></div>}
            <div><dt>Mes</dt><dd>{periodo.titulo}</dd></div>
          </dl>
        </header>

        {error ? <p className="error" role="alert">No se han podido consultar tus fichajes. Recarga la página.</p> : <>
          <div className="registro-scroll">
            <table className="registro-tabla">
              <thead><tr><th scope="col">Día</th><th scope="col">Entrada</th><th scope="col">Salida</th><th scope="col">Pausas</th><th scope="col">Horas</th></tr></thead>
              <tbody>
                {dias.flatMap((d) => {
                  const dia = porDia.get(d);
                  const texto = mayuscula(diaLargo(d));
                  if (!dia) return [<tr key={d} className="vacio"><th scope="row">{texto}</th><td>—</td><td>—</td><td>—</td><td>—</td></tr>];
                  return dia.jornadas.map((j, i) => {
                    const marca = j.correcciones.length ? "*" : "";
                    const salida = j.salida ? `${horaCorta(j.salida)}${j.salidaOtroDia ? ` (${diaSemana(diaMadrid(j.salida))})` : ""}`
                      : j.estado === "trabajando" || j.estado === "pausa" ? "En curso" : "Sin salida";
                    const horas = j.estado === "revisar" ? "Por revisar" : j.estado === "pendiente" ? "Sin salida"
                      : j.estado === "terminada" ? duracionMs(j.ms) : `${duracionMs(j.ms)} (en curso)`;
                    return <tr key={`${d}-${j.jornada.entrada.id}`}>
                      <th scope="row">{i === 0 ? texto : ""}</th>
                      <td>{horaCorta(j.entrada)}{marca}</td>
                      <td>{salida}</td>
                      <td>{j.pausas.length ? `${j.pausas.map((p) => `${horaCorta(p.desde)}–${p.hasta ? horaCorta(p.hasta) : "…"}`).join(", ")} (${duracionCorta(j.msPausas)})` : "—"}</td>
                      <td>{horas}</td>
                    </tr>;
                  });
                })}
              </tbody>
              <tfoot><tr><th scope="row" colSpan={4}>Total del mes</th><td>{duracionMs(registro.ms)}</td></tr></tfoot>
            </table>
          </div>
          {notas.length > 0 && <section className="registro-notas">
            <h2>* Corregido por el responsable</h2>
            <ul>{notas.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </section>}
          <p className="registro-pie">Horas de Madrid. Las pausas no cuentan como tiempo trabajado. Cada jornada cuenta el día en que
            empezó. Generado el {generado} desde la app de Grupo Trimodos.</p>
        </>}
      </article>
    </main>
  </>;
}
