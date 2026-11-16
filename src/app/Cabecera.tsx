import Link from "next/link";
import { AREAS } from "@/lib/permisos";
import { CONTEXTO, iniciales as inicialesDe } from "@/lib/navegacion";
import { misPendientes } from "@/lib/pendientes";
import { usuarioActual } from "@/lib/usuario";
import Icono from "./Icono";
import Navegacion, { VolverAlInicio } from "./Navegacion";

// La PWA de DECA pinta esta misma cabecera en public/deca/app.js (con /api/sesion/cabecera): si cambias el marcado, cámbialo allí.
export default async function Cabecera({ nombre }: { nombre?: string }) {
  if (nombre === undefined) {
    return <header className="shell-public-header">
      <Link href="/" aria-label="Grupo Trimodos, inicio"><img src="/deca/img/trimodos.png" alt="Grupo Trimodos" /></Link>
      <span>Personas · Transporte · Logística</span>
    </header>;
  }
  const [{ enMenu, pantalla }, { total }] = await Promise.all([usuarioActual(), misPendientes()]);
  const iniciales = inicialesDe(nombre);
  const avisos = <Link className={`shell-avisos ${total ? "con-avisos" : ""}`} href="/pendientes"
    aria-label={total ? `Pendientes: ${total}` : "Pendientes: nada"} title="Lo que tienes pendiente y tus novedades">
    <Icono nombre="campana" size={21} />{total > 0 && <span className="shell-avisos-cuenta">{total > 99 ? "99+" : total}</span>}
  </Link>;
  const usuario = <div className="shell-user">
    <span className="shell-avatar" aria-hidden="true">{iniciales}</span>
    <span className="shell-user-name">{nombre || "Mi cuenta"}</span>
    <form action="/salir" method="post">
      <button className="shell-logout" title="Cerrar sesión"><Icono nombre="salir" size={20} /><span>Salir</span></button>
    </form>
  </div>;

  // Chóferes y operarios: sin menú lateral. Todo sale de su pantalla de inicio; en las demás, un «Volver».
  if (pantalla === "campo") {
    return <div className="app-shell campo">
      <a className="shell-skip" href="#contenido-principal">Ir al contenido</a>
      <header className="campo-cabecera">
        <Link className="campo-logo" href="/" aria-label="Grupo Trimodos, inicio"><img src="/deca/img/trimodos.png" alt="Grupo Trimodos" /></Link>
        <VolverAlInicio />
        {avisos}{usuario}
      </header>
      <span id="contenido-principal" tabIndex={-1} />
    </div>;
  }

  const areas = AREAS.filter((a) => enMenu(a.id)).map(({ id, nombre, ruta }) => ({ id, nombre, ruta }));
  return (
    <div className="app-shell">
      <a className="shell-skip" href="#contenido-principal">Ir al contenido</a>
      <aside className="shell-sidebar">
        <Link className="shell-logo" href="/" aria-label="Grupo Trimodos, inicio">
          <img src="/deca/img/trimodos.png" alt="Grupo Trimodos" />
        </Link>
        <p className="shell-nav-label">{pantalla === "direccion" ? "DIRECCIÓN" : "ESPACIO DE TRABAJO"}</p>
        <Navegacion areas={areas} inicio={pantalla === "direccion" ? "Cuadro de mando" : "Inicio"} />
        <div className="shell-sidebar-footer"><span className="shell-brand-line" />
          <strong>En equipo, en movimiento.</strong><span>La conexión entre oficina y carretera.</span>
        </div>
      </aside>
      <header className="shell-header">
        <div className="shell-heading"><Icono nombre="actividad" size={20} /><span>{CONTEXTO[pantalla ?? "oficina"]}</span></div>
        {avisos}{usuario}
      </header>
      <span id="contenido-principal" tabIndex={-1} />
    </div>
  );
}
