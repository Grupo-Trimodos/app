"use strict";
// Cinemática de entrada: se abre la puerta de un contenedor (con el color del logo de cada persona) y aparece su saludo.
// La usan la web (src/app/Cinematica.tsx la carga) y DECA (public/deca/index.html): un solo dibujo para las dos.
// · La primera vez que alguien entra NO sale: solo se guardan sus datos en el dispositivo.
// · Las siguientes, al abrir la app con la sesión recordada, sale una vez por sesión del navegador, al instante, con los
//   datos guardados. Después se refrescan en segundo plano (/api/sesion/bienvenida: nombre, color y su ficha de Odoo).
// · Al cerrar sesión se borran los datos guardados (en un dispositivo compartido no sale el nombre de otra persona).
// · Se salta con un toque o con Escape. Con «reducir movimiento» del móvil, solo un fundido con el saludo.
// El logo de la puerta es el mismo dibujo que src/app/LogoTrimodos.tsx: si cambias uno, cambia el otro.
(() => {
  if (window.TrimodosCinematica) return;
  const VISTA = "trimodos-cinematica-vista";     // sessionStorage: ya salió en esta sesión del navegador
  const DATOS = "trimodos-bienvenida";           // localStorage: los datos de la última vez
  const AMARILLO = "#FDDA00";
  const IMG = "/deca/img/";

  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mezclar = (a, b, t) => "#" + hexRgb(a).map((v, i) => Math.round(v + (hexRgb(b)[i] - v) * t).toString(16).padStart(2, "0")).join("");
  const luminancia = (h) => { const [r, g, b] = hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  function paleta(color) {
    const c = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : AMARILLO;
    const claro = luminancia(c) > 0.35;
    return { puerta: c, marco: mezclar(c, "#121312", claro ? 0.92 : 0.7), estria: mezclar(c, "#ffffff", 0.45),
      marca: claro ? "#121312" : "#ffffff", op: claro ? 0.13 : 0.18 };
  }
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  // Una hoja de la puerta: se dibuja la puerta entera y el viewBox recorta su mitad. Marca de agua: el símbolo original.
  function hoja(p, lado) {
    const izq = lado === "izq";
    const estrias = (izq ? [13, 17, 21, 25, 29, 33, 37, 41, 45] : [53.6, 57.6, 61.6, 65.6, 69.6, 73.6, 77.6, 81.6, 85.6])
      .map((x) => `<rect x="${x}" y="14" width="2" height="72" fill="${p.estria}" opacity=".35"/>`).join("");
    const barras = (izq ? [20, 40] : [60, 80]).map((x) => `<rect x="${x - 0.9}" y="11" width="1.8" height="78" rx=".9"/>` +
      `<rect x="${x - 2}" y="13" width="4" height="3.2" rx=".8"/><rect x="${x - 2}" y="83.8" width="4" height="3.2" rx=".8"/>`).join("");
    const maneta = izq
      ? `<rect x="38.4" y="52" width="3.2" height="5" rx="1"/><rect class="cine-maneta izq" x="31" y="53.3" width="8" height="2.4" rx="1.2"/>`
      : `<rect x="58.4" y="52" width="3.2" height="5" rx="1"/><rect class="cine-maneta der" x="61" y="53.3" width="8" height="2.4" rx="1.2"/>`;
    return `<svg viewBox="${izq ? "10 12 40 76" : "50 12 40 76"}" preserveAspectRatio="none" aria-hidden="true">
      <defs><filter id="cine-b-${lado}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation=".7"/></filter>
        <mask id="cine-m-${lado}" maskUnits="userSpaceOnUse" x="25" y="24" width="50" height="50">
          <image href="${IMG}trimodos-simbolo-mascara.png" x="25" y="24" width="50" height="50"/></mask></defs>
      <rect x="${izq ? 10 : 50.2}" y="12" width="39.8" height="76" rx="1.5" fill="${p.puerta}"/>${estrias}
      <g filter="url(#cine-b-${lado})" opacity="${p.op}"><rect x="25" y="24" width="50" height="50" fill="${p.marca}" mask="url(#cine-m-${lado})"/></g>
      <g fill="${p.marco}">${barras}${maneta}</g></svg>`;
  }

  /** «ORTUÑO MARTÍNEZ, FÉLIX» o «Félix Ortuño» → «Félix». */
  function nombrePila(nombre) {
    let n = String(nombre || "").trim();
    if (n.includes(",")) n = n.split(",")[1].trim();
    n = n.split(/\s+/)[0] || "";
    return n === n.toUpperCase() ? n.charAt(0) + n.slice(1).toLowerCase() : n;
  }
  function empresaCorta(e) {
    const t = String(e || "").toUpperCase();
    if (t.includes("STINSA") || t.includes("INTERMODALES")) return "Stinsa";
    if (t.includes("TRANSARGI")) return "Transargi";
    if (t.includes("TRIMODOS")) return "Grupo Trimodos";
    return e || "";
  }
  function frase(t) { const s = String(t || "").trim(); return s && s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s; }
  const saludo = () => { const h = new Date().getHours(); return h < 14 ? "Buenos días" : h < 21 ? "Buenas tardes" : "Buenas noches"; };

  function reproducir(d) {
    const p = paleta(d.colorLogo);
    const reducir = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ahora = new Date();
    const fecha = ahora.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
    const hora = String(ahora.getHours()).padStart(2, "0") + ":" + String(ahora.getMinutes()).padStart(2, "0");
    const puesto = [frase(d.puesto), empresaCorta(d.empresa)].filter(Boolean).join(" · ");

    const cine = document.createElement("div");
    cine.className = "cine" + (reducir ? " cine-reducido" : "");
    cine.setAttribute("role", "dialog");
    cine.setAttribute("aria-label", `${saludo()}, ${nombrePila(d.nombre)}`);
    cine.style.setProperty("--cine-marco", p.marco);
    cine.style.setProperty("--cine-color", p.puerta);
    cine.innerHTML = `
      <div class="cine-puerta">
        <div class="cine-interior"><img src="${IMG}trimodos.png" alt=""></div>
        <div class="cine-hoja izq">${hoja(p, "izq")}</div>
        <div class="cine-hoja der">${hoja(p, "der")}</div>
      </div>
      <div class="cine-bienvenida">
        <div class="cine-lienzo"><div class="cine-texto">
          <img class="cine-logo cine-b cine-b1" src="${IMG}trimodos.png" alt="Grupo Trimodos">
          <p class="cine-hola cine-b cine-b1">${saludo()},</p>
          <p class="cine-nombre cine-b cine-b2">${esc(nombrePila(d.nombre))}</p>
          <span class="cine-raya cine-b cine-b3"></span>
          ${puesto ? `<p class="cine-puesto cine-b cine-b3">${esc(puesto)}</p>` : ""}
          <p class="cine-fecha cine-b cine-b4">${esc(fecha.charAt(0).toUpperCase() + fecha.slice(1))} · <b>${hora}</b></p>
        </div></div>
        <div class="cine-pie cine-b cine-b5"><small>EMPRESAS DEL GRUPO</small><span class="cine-logos">
          <img class="stinsa" src="${IMG}stinsa.png" alt="Stinsa"><img class="transargi" src="${IMG}transargi.png" alt="Transargi"></span></div>
        <div class="cine-franja"><span style="background:#FDDA00"></span><span style="background:#009F92"></span><span style="background:#F27C49"></span></div>
      </div>
      <span class="cine-saltar">Toca para saltar</span>`;
    document.body.append(cine);
    document.documentElement.classList.remove("cine-pendiente");

    const tiempos = [];
    const en = (ms, fn) => tiempos.push(setTimeout(fn, ms));
    let terminado = false;
    function terminar() {
      if (terminado) return;
      terminado = true;
      tiempos.forEach(clearTimeout);
      document.removeEventListener("keydown", teclas);
      cine.classList.add("cine-fuera");
      setTimeout(() => cine.remove(), 500);
    }
    function teclas(e) { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") terminar(); }
    cine.addEventListener("click", terminar);
    document.addEventListener("keydown", teclas);

    if (reducir) { cine.classList.add("cine-dentro"); en(2400, terminar); return; }
    en(400, () => cine.classList.add("cine-desbloqueada"));   // giran las manetas
    en(750, () => cine.classList.add("cine-abierta"));        // se abren las hojas
    en(1500, () => cine.classList.add("cine-dentro"));        // la cámara entra y aparece el saludo
    en(4600, terminar);                                       // fundido a la app
  }

  const leer = () => { try { return JSON.parse(localStorage.getItem(DATOS) || "null"); } catch { return null; } };
  const guardar = (d) => { try { localStorage.setItem(DATOS, JSON.stringify(d)); } catch { /* sin almacenamiento */ } };
  const yaVista = () => { try { return sessionStorage.getItem(VISTA) === "1"; } catch { return true; } };
  const marcar = () => { try { sessionStorage.setItem(VISTA, "1"); } catch { /* sin almacenamiento */ } };

  function refrescar() {
    fetch("/api/sesion/bienvenida", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && d.nombre) guardar(d); })
      .catch(() => { /* sin cobertura: se queda lo guardado */ });
  }

  let iniciada = false;
  function iniciar() {
    if (iniciada || !document.body) return;
    iniciada = true;
    const d = leer();
    const toca = !yaVista() && d && d.nombre;
    marcar();
    if (toca) reproducir(d); else document.documentElement.classList.remove("cine-pendiente");
    refrescar();
  }

  // Al cerrar sesión, fuera los datos guardados.
  document.addEventListener("submit", (e) => {
    const f = e.target;
    if (f && f.getAttribute && (f.getAttribute("action") || "").endsWith("/salir")) {
      try { localStorage.removeItem(DATOS); sessionStorage.removeItem(VISTA); } catch { /* nada */ }
    }
  }, true);

  window.TrimodosCinematica = { iniciar };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
