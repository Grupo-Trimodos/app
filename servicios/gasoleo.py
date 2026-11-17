"""Automatizaciones · Revisión del precio del transporte por gasóleo: precios semanales del Ministerio.

Sustituye a la tarea de GitHub (actualizar.py del repositorio Revision-Gasoleo) que descargaba la Excel cada 2 horas y
la guardaba en data.json. Aquí no se guarda nada: se descarga al pedirla y se queda en la memoria del proceso.

  1. Se abre la página del Ministerio de Transportes y se busca el enlace a la Excel (`buscar_enlace`).
  2. Se lee la Excel con openpyxl (`leer_excel`): hoja PRECIOS_DEL_GASOLEO y, si está, PRECIOS DE REFERENCIA (Pmed).
  3. Se devuelve el mismo formato que data.json: {fileDate, source, checkedAt, rows}, con
     rows = [[serialExcel, PVP, PVP sin IVA, IEH, PAI, devolución GP, Pmed MMA ≥ 7,5 t, Pmed MMA < 7,5 t], ...].

Copia en memoria (`CACHE_SEGUNDOS`): mientras dura, nadie espera al Ministerio. Si el Ministerio falla, se devuelve la
última copia buena con un aviso y se vuelve a intentar pasados `REINTENTO_SEGUNDOS`. Sin ninguna copia, error claro, y
ese fallo se recuerda `FALLO_SEGUNDOS`. La descarga entera (página, redirecciones y Excel) se corta al pasar de
`PLAZO_TOTAL` (como muy tarde `TIEMPOS.read` después), y una visita no espera a otra que está descargando más de `ESPERA_CERROJO`: siempre se responde antes de los 28 s de la
página y los 30 s de la función de Vercel.
Son datos públicos: no se lee ni se escribe nada de Odoo ni de Supabase (solo se comprueba la sesión y el permiso).
"""
from __future__ import annotations

import datetime as dt
import io
import logging
import re
import threading
import time
from urllib.parse import urljoin, urlsplit

import httpx
import openpyxl
from fastapi import APIRouter, Depends

from .auth import Usuario, requiere_permiso
from .errors import AppError

log = logging.getLogger("conductores")
router = APIRouter(prefix="/api/automatizaciones", tags=["automatizaciones"])

PAGINA = ("https://www.transportes.gob.es/transporte-terrestre/servicios-al-transportista/"
          "indice-de-variacion-semanal-de-los-precios-medios-del-gasoleo-en-espana")
DESDE_SERIAL = 43101  # 01/01/2018: semanas anteriores no se usan
EPOCH = dt.datetime(1899, 12, 30)
CABECERAS = {
    "User-Agent": "Mozilla/5.0 (calculadora-revision-gasoleo)",
    "Accept-Language": "es-ES,es;q=0.9",
}
# La función de Vercel tiene 30 s en total y la página espera 28 s: sin reintentos largos como en GitHub.
# PLAZO_TOTAL es para todo junto (página + redirecciones + Excel) y se comprueba en cada trozo; TIEMPOS, el máximo de
# cada espera dentro de él. httpx fija la espera de lectura al empezar cada descarga y no se puede acortar a medias: si
# el Ministerio se calla justo antes del plazo, se corta como mucho TIEMPOS.read después. Peor caso: 15 + 8 = 23 s.
PLAZO_TOTAL = 15.0
TIEMPOS = httpx.Timeout(8.0, connect=5.0)
MAX_REDIRECCIONES = 10
MAX_BYTES = 15 * 1024 * 1024        # la Excel pesa unos cientos de KB; más es que algo no cuadra
CACHE_SEGUNDOS = 2 * 3600           # como la tarea de GitHub: cada 2 horas
REINTENTO_SEGUNDOS = 10 * 60        # si el Ministerio falla, no se le vuelve a esperar en cada visita
FALLO_SEGUNDOS = 60                 # sin ninguna copia: el fallo se recuerda 1 minuto y se responde sin descargar
# Si otra visita está descargando, se espera a que termine (su peor caso, 23 s) y se usa lo que haya conseguido.
ESPERA_CERROJO = PLAZO_TOTAL + TIEMPOS.read + 1

_cache: dict = {"datos": None, "hasta": 0.0, "fallo_hasta": 0.0}
_cerrojo = threading.Lock()


class MinisterioError(Exception):
    """El Ministerio no responde o la Excel no tiene el formato esperado."""


# ---------------------------------------------------------------- lectura de la Excel (igual que actualizar.py)

def a_serial(v):
    """Fecha de Excel (número o datetime) a serial entero."""
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return (v - EPOCH).days
    if isinstance(v, dt.date):
        return (dt.datetime(v.year, v.month, v.day) - EPOCH).days
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str) and v.strip().isdigit():
        return int(v.strip())
    return None


def num(v):
    if v is None or v == "":
        return None
    try:
        # Precisión completa de la Excel (7 decimales solo para quitar el ruido de coma flotante)
        return round(float(str(v).replace(",", ".")), 7)
    except ValueError:
        return None


def leer_excel(contenido: bytes) -> list[list]:
    try:
        wb = openpyxl.load_workbook(io.BytesIO(contenido), data_only=True, read_only=True)
    except Exception as e:  # noqa: BLE001 - un fichero que no es una Excel
        raise MinisterioError(f"La Excel del Ministerio no se puede abrir: {type(e).__name__}") from None
    try:
        if "PRECIOS_DEL_GASOLEO" not in wb.sheetnames:
            raise MinisterioError(f"No está la hoja PRECIOS_DEL_GASOLEO. Hojas: {wb.sheetnames}")

        pmed = {}
        if "PRECIOS DE REFERENCIA" in wb.sheetnames:
            # Columnas B (fecha), C (Pmed MMA >= 7,5 t), D (Pmed MMA < 7,5 t)
            for fila in wb["PRECIOS DE REFERENCIA"].iter_rows(min_col=2, max_col=4, values_only=True):
                s = a_serial(fila[0])
                if s and s > 40000 and num(fila[1]) is not None:
                    pmed[s] = [num(fila[1]), num(fila[2])]

        filas = []
        # Columnas D (fecha), E (PVP), F, G, H (PVP sin IVA), I (IEH), J (PAI), K (devolución GP)
        for fila in wb["PRECIOS_DEL_GASOLEO"].iter_rows(min_col=4, max_col=11, values_only=True):
            s = a_serial(fila[0])
            if not s or s < DESDE_SERIAL or num(fila[1]) is None:
                continue
            p = pmed.get(s, [0, 0])
            filas.append([s, num(fila[1]), num(fila[4]), num(fila[5]), num(fila[6]), num(fila[7]), p[0], p[1]])
    finally:
        wb.close()

    filas.sort(key=lambda r: r[0])
    if len(filas) < 50:
        raise MinisterioError(f"Formato no reconocido: solo {len(filas)} semanas")
    return filas


def buscar_enlace(html: str) -> str | None:
    """Enlace a la Excel de precios del gasóleo. El Ministerio cambia a veces el nombre
    (p. ej. preciogasoleosemanalweb-28102026.xlsx o preciogasoleosemanalweb11-11-26.xlsx)."""
    hrefs = re.findall(r'href="([^"]+\.xlsx?)"', html, re.I)
    for h in hrefs:
        if re.search(r"precio.?gasoleo", h, re.I):
            return h
    for h in hrefs:
        if re.search(r"gasoleo|gasóleo", h, re.I):
            return h
    return hrefs[0] if len(hrefs) == 1 else None


def fecha_del_nombre(url: str, hoy: dt.date | None = None) -> str:
    """Fecha de publicación a partir del nombre del fichero; si no se reconoce, la de hoy."""
    nombre = url.rsplit("/", 1)[-1]
    m = re.search(r"(\d{2})[-_.]?(\d{2})[-_.]?(\d{4}|\d{2})(?!\d)", nombre)
    if m:
        d, mth, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100:
            y += 2000
        try:
            return dt.date(y, mth, d).isoformat()
        except ValueError:
            pass
    return (hoy or dt.date.today()).isoformat()


# ---------------------------------------------------------------- descarga

def _cliente_http() -> httpx.Client:
    # Las redirecciones se siguen a mano en `_bajar`, para que cada salto cuente contra el plazo total.
    return httpx.Client(timeout=TIEMPOS, headers=CABECERAS, follow_redirects=False)


def _url_de_la_excel(enlace: str) -> str:
    """El enlace de la página, completo. Solo se descarga de webs de la Administración (.gob.es)."""
    url = urljoin(PAGINA, enlace)
    partes = urlsplit(url)
    host = (partes.hostname or "").lower()
    if partes.scheme != "https" or not (host == "gob.es" or host.endswith(".gob.es")):
        raise MinisterioError(f"El enlace a la Excel no es de la web del Ministerio: {host or url}")
    return url


def _tiempos_hasta(limite: float) -> httpx.Timeout:
    """Las esperas de una petición, recortadas a lo que queda del plazo total. Sin tiempo, se corta."""
    queda = limite - _ahora()
    if queda <= 0:
        raise MinisterioError(f"El Ministerio tarda demasiado (más de {PLAZO_TOTAL:.0f} s)")
    return httpx.Timeout(min(TIEMPOS.read, queda), connect=min(TIEMPOS.connect, queda))


def _bajar(http: httpx.Client, url: str, limite: float) -> bytes:
    """Descarga `url` sin pasar de `limite` (reloj de `_ahora`): cada redirección y cada trozo cuentan contra él."""
    try:
        peticion = http.build_request("GET", url, timeout=_tiempos_hasta(limite))
        for _ in range(MAX_REDIRECCIONES + 1):
            r = http.send(peticion, stream=True, follow_redirects=False)
            try:
                if r.next_request is None:
                    r.raise_for_status()
                    trozos, total = [], 0
                    for trozo in r.iter_bytes():
                        total += len(trozo)
                        if total > MAX_BYTES:
                            raise MinisterioError("La descarga del Ministerio es demasiado grande")
                        _tiempos_hasta(limite)          # corta si se ha pasado el plazo total
                        trozos.append(trozo)
                    return b"".join(trozos)
                peticion = r.next_request
            finally:
                r.close()
            peticion.extensions["timeout"] = _tiempos_hasta(limite).as_dict()
    except httpx.HTTPError as e:
        raise MinisterioError(f"El Ministerio no responde ({type(e).__name__})") from None
    raise MinisterioError("El Ministerio redirige demasiadas veces")


def descargar_precios() -> dict:
    """Descarga la página y la Excel del Ministerio y devuelve los precios con el formato de data.json.
    Todo junto (página, redirecciones y Excel) tiene `PLAZO_TOTAL`: la Excel solo usa el tiempo que deje la página."""
    limite = _ahora() + PLAZO_TOTAL
    with _cliente_http() as http:
        html = _bajar(http, PAGINA, limite).decode("utf-8", "replace")
        enlace = buscar_enlace(html)
        if not enlace:
            raise MinisterioError("No encuentro el enlace a la Excel en la página del Ministerio")
        url = _url_de_la_excel(enlace)
        filas = leer_excel(_bajar(http, url, limite))
    return {"fileDate": fecha_del_nombre(url), "source": url, "checkedAt": int(time.time() * 1000), "rows": filas}


def _ahora() -> float:
    return time.monotonic()


def _sin_precios() -> AppError:
    return AppError("No se han podido descargar los precios del gasóleo del Ministerio. Inténtalo de nuevo en unos "
                    "minutos.", 503, "ministerio_no_disponible")


def _de_la_copia() -> dict | None:
    """Lo que se puede responder sin ir al Ministerio: la copia vigente, o el fallo reciente si no hay copia."""
    ahora = _ahora()
    copia = _cache["datos"]
    if copia is not None and ahora < _cache["hasta"]:
        return copia
    if copia is None and ahora < _cache["fallo_hasta"]:
        raise _sin_precios()
    return None


def precios_gasoleo() -> dict:
    """Precios con copia en memoria. Si el Ministerio falla, la última copia buena con `aviso`; sin copia, AppError
    (y ese fallo se recuerda `FALLO_SEGUNDOS` para no volver a esperar al Ministerio en cada visita)."""
    vigente = _de_la_copia()
    if vigente is not None:
        return vigente
    # Una sola descarga a la vez. Si otra visita ya está descargando, se espera como mucho ESPERA_CERROJO
    # (su descarga no pasa de PLAZO_TOTAL + TIEMPOS.read) y se usa lo que haya conseguido.
    if not _cerrojo.acquire(timeout=ESPERA_CERROJO):
        copia = _cache["datos"]
        if copia is None:
            raise _sin_precios()
        return {**copia, "aviso": "Se están descargando los precios nuevos del Ministerio: se muestran los últimos "
                                  "precios descargados. Comprueba la fecha de la Excel."}
    try:
        vigente = _de_la_copia()   # mientras se esperaba, otra visita puede haberla descargado (o haber fallado)
        if vigente is not None:
            return vigente
        copia = _cache["datos"]
        try:
            nuevos = {**descargar_precios(), "aviso": None}
        except Exception as e:  # noqa: BLE001 - cualquier fallo de la descarga se trata igual
            if isinstance(e, MinisterioError):
                log.warning("Precios del gasóleo: %s", e)
            else:
                log.exception("Precios del gasóleo: fallo inesperado")
            ahora = _ahora()
            if copia is None:
                _cache["fallo_hasta"] = ahora + FALLO_SEGUNDOS
                raise _sin_precios() from None
            _cache["hasta"] = ahora + REINTENTO_SEGUNDOS
            aviso = ("El Ministerio no responde ahora mismo: se muestran los últimos precios descargados. "
                     "Comprueba la fecha de la Excel.")
            _cache["datos"] = {**copia, "aviso": aviso}
            return _cache["datos"]
        _cache.update(datos=nuevos, hasta=_ahora() + CACHE_SEGUNDOS, fallo_hasta=0.0)
        return nuevos
    finally:
        _cerrojo.release()


# ---------------------------------------------------------------- ruta

def _sesion_real(u: Usuario):
    # El acceso local de prueba (sin Supabase) no abre esta ruta: hace falta una sesión de verdad.
    if not u.token:
        raise AppError("Tienes que iniciar sesión.", 401, "sin_sesion")


@router.get("/gasoleo/precios")
def precios(u: Usuario = Depends(requiere_permiso("automatizaciones.gasoleo"))):
    _sesion_real(u)
    return precios_gasoleo()
