import Link from "next/link";
import { AREAS } from "@/lib/permisos";
import { CONTEXTO, iniciales as inicialesDe, pestanasCampo } from "@/lib/navegacion";
import { misPendientes } from "@/lib/pendientes";
import { usuarioActual } from "@/lib/usuario";
import Icono from "./Icono";
import Navegacion, { VolverAlInicio } from "./Navegacion";
import BarraCampo from "./BarraCampo";
import NavegacionMovil from "./NavegacionMovil";
import MarcasGrupo from "./MarcasGrupo";
import { LogoTrimodos, FaviconLogo } from "./LogoTrimodos";
import { colorLogoValido } from "@/lib/colores-logo";
import Cinematica from "./Cinematica";
import { TAPA_CINEMATICA } from "@/lib/cinematica";

// La PWA de DECA pinta esta misma cabecera en public/deca/app.js (con /api/sesion/cabecera): si cambias el marcado, cámbialo allí.
export default async function Cabecera({ nombre }: { nombre?: string }) {
  if (nombre === undefined) {
    return <header className="shell-public-header">
      <Link href="/" aria-label="Grupo Trimodos, inicio"><img src="/deca/img/trimodos.png" alt="Grupo Trimodos" /></Link>
      <span>El espacio de nuestro equipo</span>
    </header>;
  }
  const [{ enMenu, pantalla, supabase, uid }, { total }] = await Promise.all([usuarioActual(), misPendientes()]);
  // Color del logo que ha elegido en «Mi perfil» (public.preferencias_usuario); sin elegir, el amarillo del grupo.
  const { data: pref } = await supabase.from("preferencias_usuario").select("color_logo").eq("usuario_id", uid)
    .maybeSingle<{ color_logo: string | null }>();
  const colorLogo = colorLogoValido(pref?.color_logo);
  const iniciales = inicialesDe(nombre);
  const entrada = <><script dangerouslySetInnerHTML={{ __html: TAPA_CINEMATICA }} /><Cinematica /></>;
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

  // Chóferes y operarios: sin menú lateral. Arriba, el logo y un «Inicio»; abajo, una barra fija con sus pestañas
  // (cada una según sus permisos; «Herramientas», solo con alguna automatización). DECA pinta la de arriba igual
  // (public/deca/cabecera.js), incluidos los mismos accesos inferiores.
  if (pantalla === "campo") {
    const pestanas = pestanasCampo(enMenu);
    return <div className={`app-shell campo ${pestanas.length > 1 ? "con-barra" : ""}`}>
      {entrada}
      <a className="shell-skip" href="#contenido-principal">Ir al contenido</a>
      <header className="campo-cabecera">
        <Link className="campo-logo" href="/" aria-label="Grupo Trimodos, inicio"><LogoTrimodos color={colorLogo} size={40} /></Link>
        <FaviconLogo color={colorLogo} />
        <VolverAlInicio />
        {avisos}{usuario}
      </header>
      <span id="contenido-principal" tabIndex={-1} />
      <BarraCampo pestanas={pestanas} />
    </div>;
  }

  const areas = AREAS.filter((a) => enMenu(a.id)).map(({ id, nombre, ruta }) => ({ id, nombre, ruta }));
  return (
    <div className="app-shell">
      {entrada}
      <a className="shell-skip" href="#contenido-principal">Ir al contenido</a>
      <aside className="shell-sidebar">
        <Link className="shell-logo logo-personal" href="/" aria-label="Grupo Trimodos, inicio">
          <LogoTrimodos color={colorLogo} size={44} />
          <span className="logo-personal-texto"><small>GRUPO</small>TRIMODOS</span>
        </Link>
        <FaviconLogo color={colorLogo} />
        <p className="shell-nav-label">{pantalla === "direccion" ? "DIRECCIÓN" : "ESPACIO DE TRABAJO"}</p>
        <Navegacion areas={areas} inicio={pantalla === "direccion" ? "Cuadro de mando" : "Inicio"} />
        <div className="shell-sidebar-footer"><span className="shell-brand-line" />
          <strong>En equipo, en movimiento.</strong><span>La conexión entre oficina y carretera.</span>
          <MarcasGrupo />
        </div>
      </aside>
      <header className="shell-header">
        <div className="shell-heading"><Icono nombre="actividad" size={20} /><span>{CONTEXTO[pantalla ?? "oficina"]}</span></div>
        {avisos}{usuario}
      </header>
      <span id="contenido-principal" tabIndex={-1} />
      <NavegacionMovil areas={areas} inicio={pantalla === "direccion" ? "Cuadro de mando" : "Inicio"} />
    </div>
  );
}
