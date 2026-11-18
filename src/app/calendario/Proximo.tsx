import Link from "next/link";
import Icono from "../Icono";
import { diaCorto, diaMadrid, diasQueOcupa, horaMadrid } from "@/lib/calendario";
import { hoyISO, inicioDia } from "@/lib/jornada";
import { usuarioActual } from "@/lib/usuario";

type Cosa = { titulo: string; empieza: string; termina: string | null; todo_el_dia: boolean };

/** Una línea en el inicio del móvil: lo próximo de su calendario (sus notas y las fechas señaladas que le tocan).
 *  Si el calendario aún no está preparado en la base de datos, o no hay nada en dos meses, no sale nada. */
export default async function ProximoCalendario() {
  const { supabase, uid } = await usuarioActual();
  const ahora = new Date(), hoy = hoyISO();
  const desde = inicioDia().toISOString(), hasta = new Date(ahora.getTime() + 60 * 864e5).toISOString();
  const [notas, fechas] = await Promise.all([
    supabase.from("calendario_notas").select("titulo,empieza,termina,todo_el_dia").eq("usuario_id", uid)
      .or(`termina.gte."${desde}",empieza.gte."${desde}"`).lt("empieza", hasta).order("empieza").limit(10).returns<Cosa[]>(),
    supabase.rpc("fechas_senaladas_entre", { desde, hasta }),
  ]);
  // Lo que todavía no ha pasado: los días completos hasta que acaban; lo demás, hasta su hora de fin.
  const pendiente = (c: Cosa) => (c.todo_el_dia ? diasQueOcupa(c)[1] >= hoy : Date.parse(c.termina ?? c.empieza) >= ahora.getTime());
  const proximo = [...(notas.data ?? []), ...((fechas.data ?? []) as Cosa[])].filter(pendiente)
    .sort((a, b) => Date.parse(a.empieza) - Date.parse(b.empieza))[0];
  if (!proximo) return null;
  const dia = diaMadrid(proximo.empieza);
  const empezado = Date.parse(proximo.empieza) <= ahora.getTime();
  const cuando = empezado ? (proximo.todo_el_dia ? "Hoy" : "Ahora")
    : `${dia === hoy ? "Hoy" : diaCorto(dia)}${proximo.todo_el_dia ? "" : `, ${horaMadrid(proximo.empieza)}`}`;
  return <nav className="campo-accesos" aria-label="Próximo en tu calendario">
    <Link href="/calendario"><Icono nombre="calendario" size={22} />
      <span>Próximo en tu calendario: <b>{proximo.titulo}</b> · {cuando}</span>
      <Icono nombre="flecha" size={18} /></Link>
  </nav>;
}
