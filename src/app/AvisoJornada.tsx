import { avisoJornada, type calcularJornada } from "@/lib/jornada";

export default function AvisoJornada({ resumen, error }: { resumen: ReturnType<typeof calcularJornada>; error?: boolean }) {
  if (error) return <p className="error" role="alert">No se ha podido consultar tu jornada. Recarga la página antes de fichar.</p>;
  return <>
    {resumen.actual?.pendiente && <p className="error" role="alert">{avisoJornada(resumen.actual)}</p>}
    {resumen.actual && <p className="hint">Horas provisionales{resumen.actual.pendiente ? ", detenidas hasta que se anote la salida real" : ": la jornada sigue abierta"}. No están incluidas en las horas cerradas.</p>}
    {resumen.incidencias.length > 0 && <p className="error" role="alert">Hay fichajes que requieren revisión. Avisa a tu responsable. Las jornadas con incidencias no se incluyen en las horas cerradas.</p>}
  </>;
}
