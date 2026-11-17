"use client";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { calcularJornada, presentarJornada, duracion, fecha, NOMBRE_ESTADO, BOTON_TIPO, SIGUIENTES, type Fichaje } from "@/lib/jornada";
import AvisoJornada from "./AvisoJornada";
import { fichar } from "./fichaje/acciones";

function Botones({ tipo, principal }: { tipo: Fichaje["tipo"]; principal: boolean }) {
  const { pending } = useFormStatus();
  const [confirmando, setConfirmando] = useState(false);
  const clase = `btn ancho grande ${principal ? "primario" : "campo-secundario"}`;
  if (tipo !== "salida") return <button className={clase} disabled={pending}>{pending ? "Guardando…" : BOTON_TIPO[tipo]}</button>;
  if (!confirmando) return <button type="button" className={clase} onClick={() => setConfirmando(true)}>Terminar jornada</button>;
  return <div className="confirmar-jornada" role="group" aria-label="Confirmar fin de jornada">
    <p>¿Has terminado de trabajar por hoy?</p>
    <button className="btn ancho grande primario" disabled={pending}>{pending ? "Guardando salida…" : "Sí, fichar salida"}</button>
    <button type="button" className="btn ancho" disabled={pending} onClick={() => setConfirmando(false)}>Seguir trabajando</button>
  </div>;
}

/** El reloj es orientativo. El servidor vuelve a comprobar el estado antes de cada fichaje. */
export default function RelojJornada({ fichajes, instante, error = false, permitirFichar = true, volver = "/fichaje" }: {
  fichajes: Fichaje[]; instante: string; error?: boolean; permitirFichar?: boolean; volver?: "/" | "/fichaje";
}) {
  const [ahora, setAhora] = useState(instante);
  const router = useRouter();
  useEffect(() => {
    // Partimos del instante del servidor: el reloj del dispositivo no cambia las horas mostradas.
    const inicio = performance.now();
    const actualizar = () => setAhora(new Date(Date.parse(instante) + performance.now() - inicio).toISOString());
    actualizar();
    const timer = window.setInterval(actualizar, 15000);
    const volverAPantalla = () => { if (document.visibilityState === "visible") { actualizar(); router.refresh(); } };
    document.addEventListener("visibilitychange", volverAPantalla);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", volverAPantalla); };
  }, [instante, router]);
  const resumen = calcularJornada(fichajes, new Date(ahora));
  const vista = presentarJornada(resumen, new Date(ahora));
  const acciones = SIGUIENTES[resumen.estado];
  const ordenadas = [...acciones].sort((a,b) => Number(b === "salida") - Number(a === "salida"));
  return <div className="reloj-jornada">
    <span className={`inicio-estado ${error ? "" : resumen.estado}`}><i />{error ? "Sin datos de jornada" : resumen.estado === "fuera" && resumen.jornadas.at(-1)?.salida ? "Jornada terminada" : NOMBRE_ESTADO[resumen.estado]}</span>
    <p className="campo-jornada-tiempo">{error ? "—" : duracion(vista.minutos)}</p>
    <p className="campo-jornada-sub">{vista.etiqueta}{vista.entrada && <> · entrada el {fecha(vista.entrada)}</>}</p>
    {!error && <p className="jornada-semana">Esta semana <strong>{duracion(vista.minutosSemana)}</strong><small>{vista.actualIncluida ? "Incluye lo que llevas en esta jornada." : "Jornadas terminadas, por su día de entrada."}</small></p>}
    <AvisoJornada resumen={resumen} error={error} />
    {permitirFichar && !error && <div className="campo-botones">{ordenadas.map((tipo,i) => <form key={`${resumen.estado}-${tipo}`} action={fichar}>
      <input type="hidden" name="tipo" value={tipo} /><input type="hidden" name="volver" value={volver} />
      <Botones tipo={tipo} principal={i === 0} />
    </form>)}</div>}
  </div>;
}
