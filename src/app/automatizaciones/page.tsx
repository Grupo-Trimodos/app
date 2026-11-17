import Link from "next/link";
import Cabecera from "../Cabecera";
import Icono from "../Icono";
import { AUTOMATIZACIONES, PERMISOS_AUTOMATIZACIONES } from "@/lib/automatizaciones";
import { conPermiso } from "@/lib/usuario";
import "../datos.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Automatizaciones · Grupo Trimodos" };

/** Portada de la sección: una tarjeta por cada automatización que la persona tiene permitida. */
export default async function Automatizaciones() {
  const { perfil, puede } = await conPermiso(...PERMISOS_AUTOMATIZACIONES);
  const mias = AUTOMATIZACIONES.filter((a) => puede(a.permiso));
  return <>
    <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
    <main className="contenido datos-page" id="contenido">
      <header className="datos-cabecera">
        <span className="datos-ceja">AUTOMATIZACIONES</span>
        <h1>Automatizaciones</h1>
        <p>Herramientas que hacen solas el trabajo repetitivo, con datos oficiales al día.</p>
      </header>
      <nav className="inicio-modulos" aria-label="Automatizaciones disponibles">
        {mias.map((a) => <Link key={a.id} className="inicio-modulo" href={a.ruta}>
          <div className="inicio-modulo-top">
            <span className="inicio-icono"><Icono nombre={a.icono} size={25} /></span><span>{a.etiqueta}</span><Icono nombre="flecha" size={19} />
          </div>
          <h3>{a.nombre}</h3><p>{a.descripcion}</p>
        </Link>)}
      </nav>
    </main>
  </>;
}
