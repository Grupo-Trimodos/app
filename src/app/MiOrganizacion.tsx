import Link from "next/link";
import { llamarPythonDetalle } from "@/lib/python";
import OrigenDato from "./OrigenDato";

type Ficha = { empresa: string | null; area: string | null; ubicacion: string | null; puesto: string | null; responsable: string | null };
export default async function MiOrganizacion({ abierto = false }: { abierto?: boolean } = {}) {
  const { datos, error } = await llamarPythonDetalle<{ ficha: Ficha | null; aviso: string | null }>("/api/odoo/mi-organizacion");
  return <details className="panel mi-organizacion" open={abierto}>
    <summary>Mi empresa y mi equipo</summary>
    {!abierto && <p><Link href="/perfil">Abrir mi perfil →</Link></p>}
    {error && <p className="hint">{error}</p>}
    {datos?.aviso && <p className="hint">{datos.aviso}</p>}
    {datos?.ficha && <>
      <dl className="organizacion-ficha">
        {([
          ["empresa", "Empresa"], ["area", "Departamento"], ["ubicacion", "Ubicación de trabajo"],
          ["puesto", "Puesto"], ["responsable", "Responsable"],
        ] as const).map(([campo, etiqueta]) => <div key={campo}><dt>{etiqueta}</dt><dd>{datos.ficha![campo] || "Sin indicar en Odoo"}</dd></div>)}
      </dl>
      <OrigenDato fuente="Odoo · Mi ficha de empleado">
        <p>Datos de tu ficha vinculada: empresa, departamento, ubicación de trabajo, puesto y gerente. Si falta algo, pide su revisión en Odoo.</p>
        <p>El responsable de tu ficha y quien aprueba tus solicitudes en la app pueden diferir mientras se revisan los vínculos.</p>
      </OrigenDato>
    </>}
  </details>;
}
