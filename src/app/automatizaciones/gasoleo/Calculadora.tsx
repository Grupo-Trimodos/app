"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BASES, REDONDEOS, VEHICULOS, calcular, cargarSemanas, conVehiculo, entradaInicial, fmtFecha, gpFijo, grafica, nf,
  restaurarEntrada, semanasUsadas, textos,
  type BaseElegida, type Entrada, type FilaExcel, type Periodo, type Vehiculo,
} from "@/lib/gasoleo";
import { compartirResultado } from "./compartir";

/** Lo último escrito se recuerda en este navegador (como la calculadora original). */
const CLAVE = "automatizaciones.gasoleo";

export default function Calculadora({ filas, fechaExcel }: { filas: FilaExcel[]; fechaExcel: string }) {
  const semanas = useMemo(() => cargarSemanas(filas), [filas]);
  const inicial = useMemo(() => entradaInicial(semanas), [semanas]);
  const [e, setE] = useState<Entrada>(inicial);
  const [leido, setLeido] = useState(false);

  // Primero lo inicial (igual en el servidor y en el navegador); después, lo guardado en el navegador.
  useEffect(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(CLAVE) || "null");
      if (guardado) setE(restaurarEntrada(guardado, inicial));
    } catch { /* sin almacenamiento: se queda lo inicial */ }
    setLeido(true);
  }, [inicial]);
  useEffect(() => {
    if (!leido) return;
    try { localStorage.setItem(CLAVE, JSON.stringify(e)); } catch { /* navegador privado o sin espacio */ }
  }, [e, leido]);

  const r = useMemo(() => calcular(semanas, e), [semanas, e]);
  const t = textos(e, r);
  const cambiar = (c: Partial<Entrada>) => setE((x) => ({ ...x, ...c }));
  const cambiarPeriodo = (k: "referencia" | "realizacion", c: Partial<Periodo>) => setE((x) => ({ ...x, [k]: { ...x[k], ...c } }));

  return <>
    <div className="gasoleo-par">
      <PanelPeriodo id="ref" tipo="ref" etiqueta="Referencia" titulo="Fecha del contrato" periodo={e.referencia}
        onCambio={(c) => cambiarPeriodo("referencia", c)} valor={t.refVal} detalle={t.refSemanas} />
      <PanelPeriodo id="real" tipo="real" etiqueta="Cálculo" titulo="Realización del transporte" periodo={e.realizacion}
        onCambio={(c) => cambiarPeriodo("realizacion", c)} valor={t.realVal} detalle={t.realSemanas} />
    </div>

    <section className="panel gasoleo-ajustes" aria-labelledby="gasoleo-ajustes">
      <h2 id="gasoleo-ajustes">Vehículo y contrato</h2>
      <div className="gasoleo-campos">
        <div className="gasoleo-campo ancho">
          <label htmlFor="gasoleo-veh">Tipo de vehículo</label>
          <select id="gasoleo-veh" value={e.vehiculo} onChange={(ev) => setE((x) => conVehiculo(x, ev.target.value as Vehiculo))}>
            {VEHICULOS.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
        </div>
        <div className="gasoleo-campo ancho">
          <label htmlFor="gasoleo-base">Precio para calcular G</label>
          <select id="gasoleo-base" value={e.base} onChange={(ev) => cambiar({ base: ev.target.value as BaseElegida })}>
            {BASES.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </div>
        <div className="gasoleo-campo">
          <label htmlFor="gasoleo-precio">Precio pactado del transporte (€)</label>
          <CampoNumero id="gasoleo-precio" valor={e.precio} min={0} paso={0.01} onCambio={(v) => cambiar({ precio: v })} />
        </div>
        <div className="gasoleo-campo">
          <label htmlFor="gasoleo-umbral">Umbral de revisión (%)</label>
          <CampoNumero id="gasoleo-umbral" valor={e.umbral} min={0} paso={0.1} onCambio={(v) => cambiar({ umbral: v })} />
        </div>
        <div className="gasoleo-campo">
          <label htmlFor="gasoleo-redondeo">Redondeo de G (decimales del %)</label>
          <select id="gasoleo-redondeo" value={e.redondeo} onChange={(ev) => cambiar({ redondeo: ev.target.value })}>
            {REDONDEOS.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select>
        </div>
      </div>
      <div className="gasoleo-casillas">
        <label className="gasoleo-casilla">
          <input type="checkbox" checked={e.gp} disabled={gpFijo(e.vehiculo)} onChange={(ev) => cambiar({ gp: ev.target.checked })} />
          <span>Vehículo de MMA ≥ 7,5 t (con devolución de gasóleo profesional)</span>
        </label>
        <label className="gasoleo-casilla">
          <input type="checkbox" checked={e.continuado} onChange={(ev) => cambiar({ continuado: ev.target.checked })} />
          <span>Contrato de transporte continuado (revisión en cada facturación)</span>
        </label>
        <label className="gasoleo-casilla">
          <input type="checkbox" checked={e.cManual} onChange={(ev) => cambiar({ cManual: ev.target.checked })} />
          <span>Fijar C a mano</span>
        </label>
        {e.cManual && <div className="gasoleo-campo gasoleo-c">
          <label htmlFor="gasoleo-c">Coeficiente C</label>
          <CampoNumero id="gasoleo-c" valor={e.cValor} min={0} max={1} paso={0.05} onCambio={(v) => cambiar({ cValor: v })} />
        </div>}
      </div>
      <p className="hint gasoleo-pista">{t.pista}</p>
    </section>

    <section className="gasoleo-resultado" aria-live="polite" aria-labelledby="gasoleo-resultado">
      <h2 id="gasoleo-resultado">Resultado</h2>
      <div className="gasoleo-cifras">
        <div><span className="gasoleo-k">Variación del transporte</span><strong className="gasoleo-v">{t.pct}</strong><span className="gasoleo-s">G × C</span></div>
        <div><span className="gasoleo-k">Variación del gasóleo (G)</span><strong className="gasoleo-v pequena">{t.G}</strong><span className="gasoleo-s">{t.Gdetalle}</span></div>
        <div><span className="gasoleo-k">Coeficiente C</span><strong className="gasoleo-v pequena">{t.C}</strong><span className="gasoleo-s">{t.Cdetalle}</span></div>
        <div><span className="gasoleo-k">Importe a revisar (ΔP)</span><strong className="gasoleo-v pequena">{t.dP}</strong><span className="gasoleo-s">{t.nuevoPrecio}</span></div>
      </div>
      <div className="gasoleo-veredicto">
        <span className={`gasoleo-pill ${t.veredictoClase}`}>{t.veredicto}</span>
        <span className="gasoleo-formula">{t.formula}</span>
        <Compartir entrada={e} resultado={r} fechaExcel={fechaExcel} />
      </div>
    </section>

    <Grafica semanas={semanas} resultado={r} serie={t.serie} />

    <details className="panel gasoleo-semanas">
      <summary>Semanas utilizadas</summary>
      <div className="gasoleo-tabla">
        <table>
          <thead><tr><th>Semana (lunes)</th><th>PVP</th><th>PVP sin IVA</th><th>Impuesto hidrocarburos</th><th>PAI</th><th>Devol. GP</th><th>Pmed ≥ 7,5 t</th><th>Pmed &lt; 7,5 t</th></tr></thead>
          <tbody>{semanasUsadas(semanas, r.wr, r.wt).map(({ semana: w, clase }) => <tr key={w.ms} className={clase === "in-ref" ? "en-ref" : "en-real"}>
            <td>{fmtFecha(w.ms)}</td><td>{nf(w.pvp, 5)}</td><td>{nf(w.pvpsin, 5)}</td><td>{nf(w.ieh, 5)}</td><td>{nf(w.pai, 5)}</td>
            <td>{nf(w.gp, 3)}</td><td>{nf(w.pge, 5)}</td><td>{nf(w.plt, 5)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </>;
}

function PanelPeriodo({ id, tipo, etiqueta, titulo, periodo, onCambio, valor, detalle }: {
  id: string; tipo: "ref" | "real"; etiqueta: string; titulo: string; periodo: Periodo;
  onCambio: (c: Partial<Periodo>) => void; valor: string; detalle: string;
}) {
  return <section className={`panel gasoleo-periodo ${tipo}`} aria-labelledby={`gasoleo-${id}`}>
    <div className="gasoleo-periodo-top">
      <span className={`gasoleo-etiqueta ${tipo}`}>{etiqueta}</span>
      <div className="gasoleo-modo" role="group" aria-label={`${titulo}: por fecha o por mes`}>
        <button type="button" aria-pressed={periodo.modo === "fecha"} onClick={() => onCambio({ modo: "fecha" })}>Fecha</button>
        <button type="button" aria-pressed={periodo.modo === "mes"} onClick={() => onCambio({ modo: "mes" })}>Mes</button>
      </div>
    </div>
    <h2 id={`gasoleo-${id}`}>{titulo}</h2>
    {periodo.modo === "fecha"
      ? <><label htmlFor={`gasoleo-${id}-fecha`}>Fecha</label>
        <input type="date" id={`gasoleo-${id}-fecha`} value={periodo.fecha || ""} onChange={(ev) => onCambio({ fecha: ev.target.value })} /></>
      : <><label htmlFor={`gasoleo-${id}-mes`}>Mes</label>
        <input type="month" id={`gasoleo-${id}-mes`} value={periodo.mes || ""} placeholder="aaaa-mm" onChange={(ev) => onCambio({ mes: ev.target.value })} /></>}
    <p className="gasoleo-lectura"><strong>{valor}</strong><span>€/litro</span><small>{detalle}</small></p>
  </section>;
}

/** Campo numérico que deja escribir «1,» o «0.» sin saltar: guarda el texto y avisa con el número (NaN si está vacío). */
function CampoNumero({ id, valor, onCambio, min, max, paso }: {
  id: string; valor: number | null; onCambio: (v: number) => void; min?: number; max?: number; paso: number;
}) {
  const aTexto = (v: number | null) => (v != null && isFinite(v) ? String(v) : "");
  const [texto, setTexto] = useState(aTexto(valor));
  useEffect(() => {
    // Si el valor cambia por fuera (lo guardado en el navegador), se enseña; si es lo que se está escribiendo, no se toca.
    setTexto((x) => (Object.is(parseFloat(x), valor ?? NaN) || (x === "" && (valor == null || !isFinite(valor))) ? x : aTexto(valor)));
  }, [valor]);
  return <input type="number" id={id} inputMode="decimal" min={min} max={max} step={paso} value={texto}
    onChange={(ev) => { setTexto(ev.target.value); onCambio(parseFloat(ev.target.value)); }} />;
}

function Grafica({ semanas, resultado: r, serie }: { semanas: ReturnType<typeof cargarSemanas>; resultado: ReturnType<typeof calcular>; serie: string }) {
  const caja = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setAncho(el.clientWidth);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const g = grafica(semanas, r.base, r.ge, r.wr, r.wt, ancho);
  return <section className="panel gasoleo-grafica" aria-labelledby="gasoleo-grafica">
    <h2 id="gasoleo-grafica">Evolución del precio usado para G</h2>
    <div className="gasoleo-leyenda">
      <span><i className="linea" />{serie}</span><span><i className="ref" />Referencia</span><span><i className="real" />Realización</span>
    </div>
    <div className="gasoleo-svg" ref={caja}>
      {g && <svg role="img" aria-label="Gráfica del precio semanal del gasóleo" width={g.W} height={g.H} viewBox={`0 0 ${g.W} ${g.H}`}>
        {g.bandas.map((b) => <rect key={b.tipo} x={b.x} y={b.y} width={b.width} height={b.height} className={`banda ${b.tipo}`} />)}
        {g.rejilla.map((l, i) => <g key={i}>
          <line x1={g.m.l} x2={g.W - g.m.r} y1={l.y} y2={l.y} className="rejilla" />
          <text x={g.m.l - 6} y={l.y + 4} textAnchor="end">{l.texto}</text>
        </g>)}
        {g.meses.map((mm) => <g key={mm.x}>
          <line x1={mm.x} x2={mm.x} y1={g.H - g.m.b} y2={g.H - g.m.b + 4} className="marca" />
          <text x={mm.x} y={g.H - 8} textAnchor="middle">{mm.texto}</text>
        </g>)}
        <path d={g.area} className="area" />
        <path d={g.linea} className="linea" />
        <circle cx={g.ultimo.cx} cy={g.ultimo.cy} r={4} className="punto" />
      </svg>}
    </div>
  </section>;
}

function Compartir({ entrada, resultado, fechaExcel }: { entrada: Entrada; resultado: ReturnType<typeof calcular>; fechaExcel: string }) {
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; descargar?: () => void } | null>(null);
  return <>
    <button type="button" className="btn gasoleo-compartir" disabled={ocupado} onClick={async () => {
      setMensaje(null);
      if (resultado.pct == null) { setMensaje({ texto: "Completa las fechas para tener un resultado que compartir." }); return; }
      setOcupado(true);
      try { setMensaje(await compartirResultado(entrada, resultado, fechaExcel)); }
      catch (err) {
        console.error("Compartir el resultado del gasóleo:", err);   // el detalle, solo para quien lo revise
        setMensaje({ texto: "No se ha podido preparar la imagen para compartir. Vuelve a intentarlo o haz una captura de pantalla del resultado." });
      }
      finally { setOcupado(false); }
    }}>{ocupado ? "Preparando…" : "Compartir resultado"}</button>
    {mensaje && <p className="gasoleo-mensaje" role="status">{mensaje.texto}{mensaje.descargar && <> <button type="button" className="gasoleo-enlace" onClick={mensaje.descargar}>Descargar la imagen</button></>}</p>}
  </>;
}
