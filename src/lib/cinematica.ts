/** Aparte de src/app/Cinematica.tsx («use client») para que la cabecera, que se pinta en el servidor, pueda leerlo. */
/** Script en línea que se ejecuta antes de pintar: si toca la cinemática, tapa la app un instante (public/deca/cinematica.css). */
export const TAPA_CINEMATICA =
  'try{if(!sessionStorage.getItem("trimodos-cinematica-vista")&&localStorage.getItem("trimodos-bienvenida"))document.documentElement.classList.add("cine-pendiente")}catch(e){}';
