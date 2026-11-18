"use strict";
// La cabecera y el menú de la app, pintados aquí porque DECA no es una página de Next (tiene que abrir sin cobertura).
// Mismo marcado que src/app/Cabecera.tsx y misma hoja (/deca/cabecera.css): si cambias uno, cambia el otro.
// Los datos (nombre, menú de esa persona, pendientes e iconos) vienen de /api/sesion/cabecera y se guardan en el
// móvil: la siguiente vez la cabecera sale al instante, y sin cobertura sale la última que se vio.
(() => {
  const GUARDADO = "deca-cabecera";
  const DIBUJO = /^(<(path|circle|rect)( [a-zA-Z-]+="[\w .,-]*")*\/>)*$/;   // solo lo que dibuja Icono.tsx

  function nodo(tag, attrs = {}, ...hijos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    for (const c of hijos.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }
  function icono(dibujo, size) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const attrs = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.7",
      "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" };
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    if (typeof dibujo === "string" && DIBUJO.test(dibujo)) svg.innerHTML = dibujo;
    return svg;
  }
  const logo = (clase) => nodo("a", { class: clase, href: "/", "aria-label": "Grupo Trimodos, inicio" },
    nodo("img", { src: "/deca/img/trimodos.png", alt: "Grupo Trimodos" }));

  function navegacionMovil(enlaces, ic) {
    const directos = enlaces.length > 5 ? enlaces.slice(0, 4) : enlaces;
    const otros = enlaces.length > 5 ? enlaces.slice(4) : [];
    const enlace = (e, corto) => nodo("a", { href: e.ruta, title: e.nombre,
      class: e.id === "deca" ? "activo" : null, "aria-current": e.id === "deca" ? "page" : null },
      icono(e.icono, 24), nodo("span", {}, corto ? e.nombreMovil || e.nombre : e.nombre));
    const barra = nodo("nav", { class: "shell-mobile-nav", "aria-label": "Secciones" }, directos.map((e) => enlace(e, true)));
    if (!otros.length) return [barra];
    barra.append(nodo("button", { type: "button", popovertarget: "secciones-movil", class: otros.some((e) => e.id === "deca") ? "activo" : null },
      icono(ic.menu || '<path d="M4 6h16M4 12h16M4 18h16"/>', 24), nodo("span", {}, "Más")));
    const panel = nodo("div", { id: "secciones-movil", popover: "auto", class: "shell-mobile-panel", "aria-labelledby": "secciones-movil-titulo" },
      nodo("header", {}, nodo("h2", { id: "secciones-movil-titulo" }, "Más secciones"),
        nodo("button", { type: "button", popovertarget: "secciones-movil", popovertargetaction: "hide" }, "Cerrar")),
      nodo("nav", { "aria-label": "Más secciones" }, otros.map((e) => enlace(e, false))));
    panel.addEventListener("click", (e) => { if (e.target.closest("a")) panel.hidePopover(); });
    return [barra, panel];
  }

  function pintar(d) {
    const hueco = document.getElementById("cabecera");
    if (!hueco) return;
    const ic = (d && d.iconos) || {};
    const partes = [nodo("a", { class: "shell-skip", href: "#contenido-principal" }, "Ir al contenido")];
    const extremos = [];
    if (d) {
      const n = d.pendientes || 0;
      extremos.push(
        nodo("a", { class: "shell-avisos" + (n ? " con-avisos" : ""), href: "/pendientes", title: "Lo que tienes pendiente y tus novedades",
          "aria-label": n ? `Pendientes: ${n}` : "Pendientes: nada" },
          icono(ic.campana, 21), n > 0 ? nodo("span", { class: "shell-avisos-cuenta" }, n > 99 ? "99+" : String(n)) : null),
        nodo("div", { class: "shell-user" },
          nodo("span", { class: "shell-avatar", "aria-hidden": "true" }, d.iniciales || "GT"),
          nodo("span", { class: "shell-user-name" }, d.nombre || "Mi cuenta"),
          nodo("form", { action: "/salir", method: "post", id: "salir" },
            nodo("button", { class: "shell-logout", title: "Cerrar sesión" }, icono(ic.salir, 20), nodo("span", {}, "Salir")))));
    }
    const conMenu = d && d.pantalla !== "campo" && (d.enlaces || []).length;
    if (conMenu) {
      partes.push(
        nodo("aside", { class: "shell-sidebar" },
          logo("shell-logo"),
          nodo("p", { class: "shell-nav-label" }, d.etiqueta || "ESPACIO DE TRABAJO"),
          nodo("nav", { class: "shell-nav", "aria-label": "Navegación principal" }, d.enlaces.map((e) =>
            nodo("a", { class: "shell-nav-link" + (e.id === "deca" ? " activo" : ""), href: e.ruta, "aria-current": e.id === "deca" ? "page" : null },
              icono(e.icono, 21), nodo("span", {}, e.nombre)))),
          nodo("div", { class: "shell-sidebar-footer" }, nodo("span", { class: "shell-brand-line" }),
            nodo("strong", {}, "En equipo, en movimiento."), nodo("span", {}, "La conexión entre oficina y carretera."),
            nodo("div", { class: "marcas-grupo", "aria-label": "Empresas de Grupo Trimodos" },
              nodo("img", { src: "/deca/img/stinsa.png", alt: "Stinsa", width: 94, height: 30 }),
              nodo("img", { src: "/deca/img/transargi.png", alt: "Transargi", width: 94, height: 30 })))),
        nodo("header", { class: "shell-header" },
          nodo("div", { class: "shell-heading" }, icono(ic.actividad, 20), nodo("span", {}, d.contexto || "Grupo Trimodos")), extremos));
    } else {
      // Chóferes y operarios (y mientras no se sabe quién es): sin menú, con «Inicio» para volver.
      partes.push(nodo("header", { class: "campo-cabecera" },
        logo("campo-logo"),
        nodo("a", { class: "campo-volver", href: "/" }, icono(ic.flecha || '<path d="M4 12h16m-6-6 6 6-6 6"/>', 18), nodo("span", {}, "Inicio")),
        extremos));
    }
    if (conMenu) partes.push(...navegacionMovil(d.enlaces, ic));
    const accesos = !conMenu && d ? (d.pestanas || []) : [];
    if (accesos.length > 1) partes.push(nodo("nav", { class: "shell-mobile-nav shell-mobile-campo", "aria-label": "Secciones" },
      accesos.map((p) => nodo("a", { href: p.href }, icono(p.icono, 24), nodo("span", {}, p.texto)))));
    partes.push(nodo("span", { id: "contenido-principal", tabindex: "-1" }));
    hueco.replaceChildren(nodo("div", { class: "app-shell" + (conMenu ? "" : " campo") }, partes));
    document.body.dataset.shell = conMenu ? "oficina" : "campo";
    document.body.classList.toggle("con-navegacion-movil", !!conMenu || accesos.length > 1);
    const salir = document.getElementById("salir");
    if (salir) salir.addEventListener("submit", () => { try { localStorage.removeItem(GUARDADO); } catch { /* sin almacenamiento */ } });
  }

  let guardado = null;
  try { guardado = JSON.parse(localStorage.getItem(GUARDADO) || "null"); } catch { /* sin almacenamiento o dato roto */ }
  pintar(guardado);

  fetch("/api/sesion/cabecera", { cache: "no-store", credentials: "same-origin" })
    .then((r) => {
      if (r.status === 401) { try { localStorage.removeItem(GUARDADO); } catch { /* nada */ } return null; }
      return r.ok ? r.json() : undefined;
    })
    .then((d) => {
      if (d === undefined) return;                    // fallo del servidor: se queda la guardada
      if (d) { try { localStorage.setItem(GUARDADO, JSON.stringify(d)); } catch { /* nada */ } }
      pintar(d);
    })
    .catch(() => { /* sin cobertura: se queda la guardada */ });
})();
