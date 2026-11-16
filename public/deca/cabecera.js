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
            nodo("strong", {}, "En equipo, en movimiento."), nodo("span", {}, "La conexión entre oficina y carretera."))),
        nodo("header", { class: "shell-header" },
          nodo("div", { class: "shell-heading" }, icono(ic.actividad, 20), nodo("span", {}, d.contexto || "Grupo Trimodos")), extremos));
    } else {
      // Chóferes y operarios (y mientras no se sabe quién es): sin menú, con «Inicio» para volver.
      partes.push(nodo("header", { class: "campo-cabecera" },
        logo("campo-logo"),
        nodo("a", { class: "campo-volver", href: "/" }, icono(ic.flecha || '<path d="M4 12h16m-6-6 6 6-6 6"/>', 18), nodo("span", {}, "Inicio")),
        extremos));
    }
    partes.push(nodo("span", { id: "contenido-principal", tabindex: "-1" }));
    hueco.replaceChildren(nodo("div", { class: "app-shell" + (conMenu ? "" : " campo") }, partes));
    document.body.dataset.shell = conMenu ? "oficina" : "campo";
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
