import { formatoTelefono } from "@/lib/telefono";
import { usuarioActual } from "@/lib/usuario";
import { guardarMiTelefono } from "./perfil/acciones";
import "./telefono.css";

type MiTelefono = { pide: boolean; telefono: string | null; confirmado: string | null };

/**
 * Móvil de quien entra con código y PIN y ficha (permiso de puesto «fichaje.fichar» o «chofer.usar»). Quien entra con
 * Microsoft o Google no lo da: su responsable encuentra su ficha por su correo. En el inicio solo aparece si aún no lo
 * ha dado; en «Mi perfil» (`siempre`) se ve y se puede corregir mientras su responsable no haya confirmado su ficha de
 * Odoo. Con el móvil, su responsable comprueba en «Mi equipo → Enlazar con Odoo» que su cuenta es la de su ficha.
 */
export default async function PedirTelefono({ volver, siempre = false }: { volver: "/" | "/perfil"; siempre?: boolean }) {
  const { supabase, perfil, esDeSuPuesto } = await usuarioActual();
  if (!perfil?.activo || !esDeSuPuesto("fichaje.fichar", "chofer.usar")) return null;
  // public.mi_telefono() (migración 20261117110000) dice si se le pide (entra con PIN), el que dio y si está confirmado.
  // Si aún no está en la base de datos, no se pide nada.
  const { data: filas, error } = await supabase.rpc("mi_telefono").returns<MiTelefono[]>();
  const fila = Array.isArray(filas) ? filas[0] : null;
  if (error || !fila?.pide) return null;
  const data = { telefono: fila.telefono, vinculo_confirmado: fila.confirmado };
  if (!siempre && data.telefono) return null;

  const explicacion = <p className="hint">Solo sirve para que tu responsable compruebe que esta cuenta es la de tu ficha de
    empleado. Así tus fichajes y tus vacaciones llegan a tu ficha.</p>;
  if (data.vinculo_confirmado) {
    return <section className="panel pedir-telefono" aria-labelledby="telefono-titulo">
      <h2 id="telefono-titulo">Tu móvil</h2>
      <p><b>{formatoTelefono(data.telefono)}</b> <span className="etiqueta ok">Ficha confirmada</span></p>
      <p className="hint">Tu responsable ya ha confirmado tu ficha de empleado. Si cambias de número, díselo.</p>
    </section>;
  }
  return <section className={`panel pedir-telefono ${data.telefono ? "" : "pendiente"}`} aria-labelledby="telefono-titulo">
    <h2 id="telefono-titulo">{data.telefono ? "Tu móvil" : "Escribe tu número de móvil"}</h2>
    {data.telefono && <p><b>{formatoTelefono(data.telefono)}</b> <span className="etiqueta pronto">Falta que lo confirme tu responsable</span></p>}
    {explicacion}
    <form action={guardarMiTelefono}>
      <input type="hidden" name="volver" value={volver} />
      <label htmlFor="telefono">{data.telefono ? "¿Está mal? Escríbelo de nuevo" : "Móvil"}</label>
      <input id="telefono" name="telefono" type="tel" inputMode="tel" autoComplete="tel" required maxLength={40}
        placeholder="612 345 678" defaultValue={data.telefono ? formatoTelefono(data.telefono) : undefined} />
      <button className={`btn ancho grande ${data.telefono ? "" : "primario"}`} style={{ marginTop: 14 }}>
        {data.telefono ? "Corregir mi móvil" : "Guardar mi móvil"}</button>
    </form>
  </section>;
}
