import Cabecera from "../Cabecera";
import OrigenDato from "../OrigenDato";
import { conPermiso } from "@/lib/usuario";
import { llamarPythonDetalle } from "@/lib/python";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organización · Grupo Trimodos" };
type Grupo = { id: number | null; nombre: string; personas: number };
type Catalogo = { id: number; name: string; company_id: [number, string] | false };
type Estructura = {
  plantilla: number; sin_responsable: number; consultado: string; aviso: string | null;
  grupos: Record<string, Grupo[]>; ubicaciones: Catalogo[]; departamentos: Catalogo[]; puestos: Catalogo[];
  relaciones: { id: number; nombre: string; estado: string; modelo: string;
    candidatos: { id: number; nombre: string; empresa: string }[] }[];
};
const CUADROS = [
  { campo: "company_id", titulo: "Empresas", fuente: "Empresa de cada empleado", detalle: "La empresa legal no es el centro de trabajo." },
  { campo: "department_id", titulo: "Áreas y departamentos", fuente: "Departamento de cada empleado", detalle: "Se conserva la estructura de Odoo. Algunos departamentos representan hoy almacenes o zonas de conductores." },
  { campo: "work_location_id", titulo: "Ubicaciones de trabajo", fuente: "Ubicación de trabajo de cada empleado", detalle: "Una misma ciudad puede tener varias ubicaciones. No se unen por su nombre ni se presupone que sean oficinas." },
  { campo: "job_id", titulo: "Puestos de trabajo", fuente: "Puesto de cada empleado", detalle: "Un puesto no concede permisos en la app. Tampoco se interpreta automáticamente como un tipo de transporte." },
];
export default async function Organizacion() {
  const { perfil } = await conPermiso("organizacion.ver");
  const { datos: d, error } = await llamarPythonDetalle<Estructura>("/api/odoo/organizacion", { espera: 25000 });
  return <>
    <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
    <main className="contenido">
      <div className="pagina-titulo"><h1>Organización</h1><p>Personas, lugares y áreas de las empresas configuradas en Odoo.</p></div>
      {error && <p className="error" role="alert">{error}</p>}
      {d && <>
        <section className="panel">
          <div className="cifras"><div><b>{d.plantilla}</b><span>Empleados activos en Odoo</span></div>
            <div><b>{d.sin_responsable}</b><span>Sin gerente en su ficha</span></div></div>
          <OrigenDato fuente="Odoo · Empleados">
            <p>Solo empleados activos de las empresas configuradas. Consulta: {new Date(d.consultado).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })} (hora de Madrid).</p>
            <p>Los empleados y las cuentas de acceso a la app son listas distintas. Esta pantalla solo muestra estructura y recuentos.</p>
          </OrigenDato>
        </section>
        <div className="organizacion-cuadros">
          {CUADROS.map(c => <section className="panel" key={c.campo}>
            <h2>{c.titulo}</h2><p className="hint">{c.detalle}</p>
            <ul className="organizacion-lista">{d.grupos[c.campo].map(g => <li key={g.id ?? "sin"}>
              <span>{g.id === null ? "Sin indicar en Odoo" : g.nombre}</span><b>{g.personas}</b>
            </li>)}</ul>
            <OrigenDato fuente={`Odoo · ${c.fuente}`}>
              <p>Recuento por el identificador de cada registro, no por coincidencia de nombres. Campo de origen: <code>{c.campo}</code> en Empleados.</p>
            </OrigenDato>
          </section>)}
        </div>
        <section className="panel"><h2>Cómo se relaciona con los centros de la app</h2>
          <p>Un vínculo por identificador está registrado. Una propuesta por nombre necesita revisión y no cambia los accesos de nadie.</p>
          {d.aviso && <p className="aviso" role="status">{d.aviso}</p>}
          {!d.aviso && !d.relaciones.length && <p className="hint">No hay centros disponibles para comparar.</p>}
          {d.relaciones.map(r => <article className="panel" key={r.id}>
            <h3>{r.nombre}</h3><p className="hint">{r.estado}</p>
            {r.candidatos.map(c => <p key={c.id}>{c.nombre} · {c.empresa}</p>)}
            <OrigenDato fuente="App y Odoo">
              <p>Nombre de la app: centro #{r.id}. {r.modelo === "hr.department" ? "Coincidencia propuesta con un departamento; no confirma una ubicación de trabajo." : "Comparación con las ubicaciones de trabajo."}</p>
              {r.candidatos.map(c => <p key={c.id}>{r.modelo} · registro #{c.id}</p>)}
            </OrigenDato>
          </article>)}
        </section>
      </>}
    </main>
  </>;
}
