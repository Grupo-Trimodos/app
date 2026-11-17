import Link from "next/link";
import { Suspense } from "react";
import Cabecera from "../../Cabecera";
import { llamarPythonDetalle } from "@/lib/python";
import { conPermiso } from "@/lib/usuario";
import {
  DIA, T18, T9, URL_CALCULADORA_OFICIAL, URL_MINISTERIO, URL_NOTA_METODOLOGICA, VEHICULOS, cargarSemanas, fmtFecha, isoAMs,
  textoTramos, ultimaSemana, type DatosGasoleo,
} from "@/lib/gasoleo";
import Calculadora from "./Calculadora";
import "../../datos.css";
import "./gasoleo.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revisión por gasóleo · Grupo Trimodos" };

const MADRID = "Europe/Madrid";
/** «hoy a las 10:32», «ayer a las 18:05» o «12/11/2026 a las 09:00», en hora de Madrid. */
function cuando(ms: number, ahora = Date.now()) {
  const dia = (t: number) => new Date(t).toLocaleDateString("es-ES", { timeZone: MADRID, day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = new Date(ms).toLocaleTimeString("es-ES", { timeZone: MADRID, hour: "2-digit", minute: "2-digit" });
  const d = dia(ms);
  return (d === dia(ahora) ? "hoy" : d === dia(ahora - DIA) ? "ayer" : d) + " a las " + hora;
}

/** Los precios del Ministerio (API Python, con su copia de 2 horas) y la calculadora. */
async function Precios() {
  // La primera visita tras 2 horas descarga la Excel del Ministerio: puede tardar unos segundos.
  const { datos, error } = await llamarPythonDetalle<DatosGasoleo>("/api/automatizaciones/gasoleo/precios", { espera: 28000 });
  if (!datos || !Array.isArray(datos.rows) || !datos.rows.length) return <SinPrecios error={error} />;
  const ultima = ultimaSemana(cargarSemanas(datos.rows)).ms;
  // El Ministerio publica una vez por semana: si la última semana tiene más de 17 días, algo no ha ido bien.
  const retrasada = Date.now() > ultima + 17 * DIA;
  return <>
    <section className="panel gasoleo-estado" aria-label="Precios del Ministerio en uso">
      <div className="gasoleo-dato"><b>{fmtFecha(ultima)}</b><span>Última semana con precio</span></div>
      <div className="gasoleo-dato"><b>{fmtFecha(isoAMs(datos.fileDate))}</b><span>Excel del Ministerio en uso</span></div>
      <div className="gasoleo-dato"><b>{datos.checkedAt ? cuando(datos.checkedAt) : "—"}</b><span>Última comprobación en el Ministerio</span></div>
      <a className="btn pequeno" href={URL_MINISTERIO} target="_blank" rel="noopener noreferrer">Abrir página oficial ↗</a>
      {datos.aviso && <p className="aviso" role="status">{datos.aviso}</p>}
      {retrasada && <p className="aviso" role="status">
        La última semana con precio es del {fmtFecha(ultima)} y debería haber datos más recientes. Hasta que se resuelva,
        comprueba los precios en la <a href={URL_MINISTERIO} target="_blank" rel="noopener noreferrer">página oficial</a>.
      </p>}
    </section>
    <Calculadora filas={datos.rows} fechaExcel={datos.fileDate} />
  </>;
}

function SinPrecios({ error }: { error: string | null }) {
  return <section className="panel gasoleo-sin-precios" role="alert">
    <h2>No hay precios del gasóleo ahora mismo</h2>
    <p className="error">{error || "No se han podido cargar los precios del Ministerio."}</p>
    <p>Mientras tanto, puedes hacer el cálculo en la calculadora oficial del Ministerio de Transportes.</p>
    <div className="gasoleo-botones">
      <a className="btn primario" href={URL_CALCULADORA_OFICIAL} target="_blank" rel="noopener noreferrer">Abrir la calculadora oficial ↗</a>
      <a className="btn" href={URL_MINISTERIO} target="_blank" rel="noopener noreferrer">Ver los precios del Ministerio ↗</a>
    </div>
  </section>;
}

function Explicacion() {
  const filas = (t: typeof T18) => VEHICULOS.map((v) => <tr key={v.id}><td>{v.corto}</td><td className="mono">{textoTramos(t[v.id])}</td></tr>);
  return <>
    <details className="panel gasoleo-notas">
      <summary>Cómo se calcula</summary>
      <p className="mono">ΔP = G × P × C / 100 · G = (P<sub>cálculo</sub> − P<sub>referencia</sub>) / P<sub>referencia</sub> × 100</p>
      <p>G se redondea al número de decimales elegido (redondeo aritmético: 5 o más sube) antes de multiplicarlo por C. Ese G redondeado es también el que se compara con el umbral.</p>
      <ul>
        <li><b>Fecha puntual:</b> se toma el precio de la primera fecha de la Excel igual o posterior al día indicado. <b>Mes:</b> media simple de las semanas cuya fecha en la Excel del Ministerio pertenece a ese mes.</li>
        <li><b>Precio para G (automático):</b> transporte desde el 16/04/2026, Pmed (PVP sin IVA y, para MMA ≥ 7,5 t, sin la devolución del gasóleo profesional); del 22/03 al 15/04/2026, PAI; antes, PVP.</li>
        <li><b>Coeficiente C:</b> desde el 01/07/2026 (RDL 18/2026) según el Pmed del transporte; del 16/04 al 30/06/2026 (RDL 9/2026) según el PAI; antes, coeficiente fijo por vehículo. Si el transporte se indica por mes, se usa la media de ese mes.</li>
        <li>La revisión es obligatoria cuando |G| ≥ 5 % o el umbral menor pactado por escrito, y siempre en los contratos continuados en cada periodo de facturación. No pueden computarse las bonificaciones extraordinarias del gasóleo.</li>
      </ul>
      <div className="gasoleo-tablas-c">
        <table><thead><tr><th colSpan={2}>RDL 18/2026 · Pmed (€/l)</th></tr></thead><tbody>{filas(T18)}</tbody></table>
        <table><thead><tr><th colSpan={2}>RDL 9/2026 · PAI (€/l)</th></tr></thead><tbody>{filas(T9)}</tbody></table>
      </div>
    </details>
    <section className="panel gasoleo-legal" aria-labelledby="gasoleo-legal">
      <h2 id="gasoleo-legal">Información legal</h2>
      <p className="gasoleo-refs">Ley 15/2009, art. 38 · Orden FOM/1882/2012, condición 3.4 · Real Decreto-ley 9/2026 · Real Decreto-ley 18/2026</p>
      <p><b>Importante.</b> El resultado es orientativo y depende de los datos que introduzcas. Grupo Trimodos no se hace responsable de las decisiones que se tomen a partir de él; para un litigio o una reclamación, contrástalo con la <a href={URL_CALCULADORA_OFICIAL} target="_blank" rel="noopener noreferrer">calculadora oficial del Ministerio</a>.</p>
      <p>El cálculo aplica la fórmula de la condición 3.4 de la Orden FOM/1882/2012, en la redacción del Real Decreto-ley 9/2026 y del Real Decreto-ley 18/2026, con las reglas del artículo 38 de la Ley 15/2009, del contrato de transporte terrestre de mercancías. Los precios son los de la evolución semanal del gasóleo de automoción en España que publica el Ministerio de Transportes y Movilidad Sostenible.</p>
      <p>Desde la entrada en vigor del RD-ley 18/2026, el 1 de julio de 2026, cambian el precio de referencia que se usa y los umbrales que fijan el coeficiente C. <a href={URL_NOTA_METODOLOGICA} target="_blank" rel="noopener noreferrer">Nota metodológica del Ministerio (3/7/2026)</a>.</p>
    </section>
  </>;
}

export default async function PaginaGasoleo() {
  const { perfil } = await conPermiso("automatizaciones.gasoleo");
  return <>
    <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
    <main className="contenido datos-page gasoleo-page" id="contenido">
      <Link className="gasoleo-volver" href="/automatizaciones">← Automatizaciones</Link>
      <header className="datos-cabecera">
        <span className="datos-ceja">AUTOMATIZACIONES · GASÓLEO</span>
        <h1>Revisión del precio del transporte por gasóleo</h1>
        <p>Cuánto debe cambiar el precio de un transporte cuando sube o baja el gasóleo, con los precios semanales del Ministerio de Transportes.</p>
      </header>
      <Suspense fallback={<section className="panel gasoleo-carga" role="status" aria-busy="true">
        <h2>Consultando los precios del Ministerio</h2>
        <p className="hint">Estamos leyendo la última Excel semanal del gasóleo. Puede tardar unos segundos.</p>
        <div className="gasoleo-carga-barra" aria-hidden="true"><span /></div>
      </section>}><Precios /></Suspense>
      <Explicacion />
    </main>
  </>;
}
