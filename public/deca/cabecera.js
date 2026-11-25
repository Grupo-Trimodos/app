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
  // Logo personalizable: el mismo dibujo que src/app/LogoTrimodos.tsx, con el símbolo original de marca de agua (si cambias uno, cambia el otro). El color llega
  // de /api/sesion/cabecera (colorLogo) y se guarda con el resto: sin cobertura sale el último que se vio.
  const AMARILLO = "#FDDA00";
  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mezclar = (a, b, t) => "#" + hexRgb(a).map((v, i) => Math.round(v + (hexRgb(b)[i] - v) * t).toString(16).padStart(2, "0")).join("");
  const luminancia = (h) => { const [r, g, b] = hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  function svgLogo(color, size) {
    const c = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : AMARILLO;
    const claro = luminancia(c) > 0.35;
    const marco = mezclar(c, "#121312", claro ? 0.92 : 0.7), estria = mezclar(c, "#FFFFFF", 0.45);
    const marca = claro ? "#121312" : "#FFFFFF", op = claro ? 0.13 : 0.18;
    const estrias = [13, 17, 21, 25, 29, 33, 37, 41, 45, 53.6, 57.6, 61.6, 65.6, 69.6, 73.6, 77.6, 81.6, 85.6]
      .map((x) => `<rect x="${x}" y="14" width="2" height="72" fill="${estria}" opacity="0.35"/>`).join("");
    const barras = [20, 40, 60, 80].map((x) => `<rect x="${x - 0.9}" y="11" width="1.8" height="78" rx="0.9"/>` +
      `<rect x="${x - 2}" y="13" width="4" height="3.2" rx="0.8"/><rect x="${x - 2}" y="83.8" width="4" height="3.2" rx="0.8"/>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="Trimodos">` +
      `<defs><filter id="logo-b" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="0.7"/></filter>` +
      `<mask id="logo-m" maskUnits="userSpaceOnUse" x="25" y="24" width="50" height="50">` +
      `<image href="/deca/img/trimodos-simbolo-mascara.png" x="25" y="24" width="50" height="50"/></mask>` +
      `<clipPath id="logo-c"><rect width="100" height="100" rx="24"/></clipPath></defs><g clip-path="url(#logo-c)">` +
      `<rect width="100" height="100" fill="${marco}"/><rect x="10" y="12" width="39.4" height="76" rx="1.5" fill="${c}"/>` +
      `<rect x="50.6" y="12" width="39.4" height="76" rx="1.5" fill="${c}"/>${estrias}` +
      `<g filter="url(#logo-b)" opacity="${op}"><rect x="25" y="24" width="50" height="50" fill="${marca}" mask="url(#logo-m)"/></g><g fill="${marco}">${barras}` +
      `<rect x="38.4" y="52" width="3.2" height="5" rx="1"/><rect x="31" y="53.3" width="8" height="2.4" rx="1.2"/>` +
      `<rect x="58.4" y="52" width="3.2" height="5" rx="1"/><rect x="61" y="53.3" width="8" height="2.4" rx="1.2"/></g></g></svg>`;
  }
  function logo(clase, color) {
    const a = nodo("a", { class: clase + (clase === "shell-logo" ? " logo-personal" : ""), href: "/", "aria-label": "Grupo Trimodos, inicio" });
    a.innerHTML = svgLogo(color, clase === "shell-logo" ? 44 : 40);   // solo números y colores validados arriba
    if (clase === "shell-logo") a.append(nodo("span", { class: "logo-personal-texto" }, nodo("small", {}, "GRUPO"), "TRIMODOS"));
    return a;
  }
  function favicon(color) {
    let link = document.querySelector("link[rel='icon']");
    if (!link) { link = nodo("link", { rel: "icon" }); document.head.append(link); }
    link.setAttribute("type", "image/svg+xml");
    link.setAttribute("href", "data:image/svg+xml," + encodeURIComponent(svgLogo(color, 64)));
  }

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
          logo("shell-logo", d && d.colorLogo),
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
        logo("campo-logo", d && d.colorLogo),
        nodo("a", { class: "campo-volver", href: "/" }, icono(ic.flecha || '<path d="M4 12h16m-6-6 6 6-6 6"/>', 18), nodo("span", {}, "Inicio")),
        extremos));
    }
    if (conMenu) partes.push(...navegacionMovil(d.enlaces, ic));
    const accesos = !conMenu && d ? (d.pestanas || []) : [];
    if (accesos.length > 1) partes.push(nodo("nav", { class: "shell-mobile-nav shell-mobile-campo", "aria-label": "Secciones" },
      accesos.map((p) => nodo("a", { href: p.href }, icono(p.icono, 24), nodo("span", {}, p.texto)))));
    partes.push(nodo("span", { id: "contenido-principal", tabindex: "-1" }));
    favicon(d && d.colorLogo);
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
