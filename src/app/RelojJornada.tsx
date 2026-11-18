"use client";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  duracionMs, lasHora, partesDuracion, textoOlvido, vistaDelDia, type Fichaje,
} from "@/lib/jornada";
import { ficharAhora } from "./fichaje/acciones";

const SIN_CONEXION = "No hay conexión. No se ha fichado. Inténtalo de nuevo.";
const TEXTO_BOTON: Record<Fichaje["tipo"], string> = {
  entrada: "Fichar entrada", salida: "Fichar salida", reanudar: "Volver al trabajo", pausa: "Hacer una pausa",
};
/** Botón grande (lo que toca) y, si hay, el secundario. Sin jornada pendiente de cierre: entonces no hay botones. */
const BOTONES: Record<string, [Fichaje["tipo"], Fichaje["tipo"]?]> = {
  fuera: ["entrada"], trabajando: ["salida", "pausa"], pausa: ["reanudar", "salida"],
};

/**
 * Tarjeta de la jornada del trabajador: estado con color, contador que avanza solo, la semana frente a las 40 horas y el
 * botón de fichar. El contador se calcula en el móvil a partir de los fichajes que da el servidor y de su hora (no se
 * pide nada nuevo cada segundo). Cada fichaje lo vuelve a comprobar el servidor y la base de datos: la hora que se
 * guarda es siempre la del servidor.
 */
export default function RelojJornada({ fichajes, instante, error = false, permitirFichar = true, children }: {
  fichajes: Fichaje[]; instante: string; error?: boolean; permitirFichar?: boolean; children?: ReactNode;
}) {
  const router = useRouter();
  const [ahora, setAhora] = useState(() => Date.parse(instante));
  const [enviando, empezar] = useTransition();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [confirmarSalida, setConfirmarSalida] = useState(false);

  useEffect(() => {
    // Partimos de la hora del servidor: si el reloj del móvil va mal, no cambia lo que se ve.
    const base = Date.parse(instante);
    const inicio = performance.now();
    const actualizar = () => setAhora(base + performance.now() - inicio);
    const timer = window.setInterval(actualizar, 1000);
    // Al volver a la app (el móvil estuvo bloqueado), datos y hora nuevos.
    const alVolver = () => { if (document.visibilityState === "visible") { actualizar(); router.refresh(); } };
    document.addEventListener("visibilitychange", alVolver);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", alVolver); };
  }, [instante, router]);

  useEffect(() => {
    if (!mensaje?.ok) return;
    const t = window.setTimeout(() => setMensaje(null), 20000);
    return () => window.clearTimeout(t);
  }, [mensaje]);

  const momento = new Date(ahora);
  const v = vistaDelDia(fichajes, momento);
  const { h, min, seg } = partesDuracion(v.msGrande);
  const porcentaje = Math.min(100, Math.round((v.msSemana / v.msObjetivo) * 100));
  const estadoTexto = error ? "Sin datos de tu jornada"
    : v.estado === "trabajando" ? `Trabajando desde ${v.desdeAyer ? "ayer a " : ""}${lasHora(v.desde!)}`
    : v.estado === "pausa" ? `En pausa desde ${lasHora(v.desde!)}`
    : v.estado === "pendiente" ? "Falta fichar la salida"
    : v.terminadaHoy ? `Jornada terminada a ${lasHora(v.desde!)}` : "Sin fichar";
  const clase = error ? "sin-datos" : v.terminadaHoy ? "terminada" : v.estado;

  function fichar(tipo: Fichaje["tipo"]) {
    setConfirmarSalida(false);
    if (navigator.onLine === false) { setMensaje({ ok: false, texto: SIN_CONEXION }); return; }
    empezar(async () => {
      try {
        const r = await ficharAhora(tipo);
        setMensaje({ ok: r.ok, texto: r.mensaje });
        if (r.ok) try { navigator.vibrate?.(tipo === "salida" ? [90, 60, 90] : 90); } catch { /* sin vibración */ }
      } catch {
        // Se cortó la conexión a mitad o el servidor no respondió: no sabemos si llegó. Se vuelve a leer la jornada.
        setMensaje({ ok: false, texto: navigator.onLine === false ? SIN_CONEXION
          : "No se ha podido confirmar el fichaje. Mira cómo está tu jornada antes de volver a intentarlo." });
        router.refresh();
      }
    });
  }

  const [principal, secundario] = error ? [] : BOTONES[v.estado] ?? [];
  const boton = (tipo: Fichaje["tipo"], esPrincipal: boolean) => <button type="button" key={tipo} disabled={enviando}
    className={`btn ancho ${esPrincipal ? "primario campo-principal" : "campo-secundario"}`}
    onClick={() => (tipo === "salida" ? setConfirmarSalida(true) : fichar(tipo))}>
    {enviando && esPrincipal ? "Guardando…" : TEXTO_BOTON[tipo]}
  </button>;

  return <>
    {!error && v.olvido && <p className="campo-olvido" role="alert">
      <b>{textoOlvido(v.olvido, momento)}</b>
      <span>Hasta que la cierre no puedes volver a fichar. Avísale para que lo haga cuanto antes.</span>
    </p>}
    <section className={`campo-jornada ${clase}`} aria-labelledby="campo-jornada-t">
      <h2 id="campo-jornada-t" className="sr-only">Mi jornada</h2>
      <p className="campo-estado"><i aria-hidden="true" />{estadoTexto}</p>
      {!error && <>
        <p className="campo-jornada-sub">{v.etiqueta}</p>
        <p className="campo-jornada-tiempo" aria-live="off">
          <span>{h}</span><small> h </small><span>{String(min).padStart(2, "0")}</span><small> min</small>
          {v.estado === "trabajando" && <small className="campo-segundos" aria-hidden="true"> {String(seg).padStart(2, "0")} s</small>}
        </p>
        {v.msHoyTotal !== null && <p className="campo-jornada-sub">Hoy en total: <b>{duracionMs(v.msHoyTotal)}</b></p>}
        <div className="campo-semana">
          <p>Esta semana: <b>{duracionMs(v.msSemana)}</b> de {v.msObjetivo / 3600000} h</p>
          <div className="campo-semana-barra" aria-hidden="true"><i style={{ width: `${porcentaje}%` }} /></div>
        </div>
        {v.revisar && <p className="campo-jornada-nota">Tu responsable tiene que revisar algún fichaje. Hasta entonces, esas horas no se suman.</p>}
      </>}
      {error && <p className="campo-jornada-nota">No se ha podido consultar tu jornada. Recarga la página antes de fichar.</p>}

      {mensaje && <p className={`campo-resultado ${mensaje.ok ? "ok" : "mal"}`} role={mensaje.ok ? "status" : "alert"}>{mensaje.texto}</p>}

      {permitirFichar && principal && (confirmarSalida
        ? <div className="campo-botones" role="group" aria-label="Confirmar la salida">
          <p className="campo-pregunta">¿Has terminado tu jornada?</p>
          <button type="button" className="btn ancho primario campo-principal" disabled={enviando} onClick={() => fichar("salida")}>
            {enviando ? "Guardando…" : "Sí, fichar salida"}</button>
          <button type="button" className="btn ancho campo-secundario" disabled={enviando} onClick={() => setConfirmarSalida(false)}>
            No, seguir trabajando</button>
        </div>
        : <div className="campo-botones">{boton(principal, true)}{secundario && boton(secundario, false)}</div>)}
      {children}
    </section>
  </>;
}
