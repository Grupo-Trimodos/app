import Link from "next/link";
import { redirect } from "next/navigation";
import Cabecera from "../Cabecera";
import Icono from "../Icono";
import { AUTOMATIZACIONES } from "@/lib/automatizaciones";
import { usuarioActual } from "@/lib/usuario";
import "../datos.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Herramientas · Grupo Trimodos" };

/**
 * Portada de la sección: una tarjeta por cada automatización que la persona tiene permitida. En la app del móvil
 * (pantalla «campo») es la pestaña «Herramientas», con tarjetas grandes; si no tiene ninguna, lo dice (la pestaña ya no
 * sale en ese caso, pero alguien puede llegar con un enlace).
 */
export default async function Automatizaciones() {
  const { perfil, puede, pantalla } = await usuarioActual();
  if (!perfil?.activo) redirect("/");
  const mias = AUTOMATIZACIONES.filter((a) => puede(a.permiso));
  const nombre = perfil.nombre || perfil.codigo || "";

  if (pantalla === "campo") return <>
    <Cabecera nombre={nombre} />
    <main className="contenido estrecho campo-oscuro">
      <h1>Herramientas</h1>
      {mias.length === 0 ? <p className="campo-tarjeta campo-vacio">Todavía no tienes herramientas activadas.</p>
        : <nav className="campo-herramientas" aria-label="Tus herramientas">
          {mias.map((a) => <Link key={a.id} href={a.ruta}>
            <span className="campo-herramienta-icono"><Icono nombre={a.icono} size={30} /></span>
            <span><b>{a.nombre}</b><small>{a.descripcion}</small></span>
            <Icono nombre="flecha" size={22} />
          </Link>)}
        </nav>}
    </main>
  </>;

  if (mias.length === 0) redirect("/");
  return <>
    <Cabecera nombre={nombre} />
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
