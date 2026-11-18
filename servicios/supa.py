"""Lectura y escritura en Supabase desde la API Python.

Normalmente SIEMPRE con el token del usuario: se aplican sus permisos (RLS) y la API solo puede hacer lo que el propio
usuario podría hacer.

Excepción: el proceso de sincronización con Odoo (servicios/sincronizacion.py), lanzado por el cron de Vercel o por
alguien con el permiso «admin.sincronizacion», usa `SERVICIO` (la clave secreta, SUPABASE_SECRET_KEY) para enviar lo
pendiente de todas las personas. La clave secreta va SOLO en la cabecera `apikey` y nunca sale del servidor.

Segunda excepción, del mismo tipo (decide a qué ficha de Odoo van los envíos): el enlace de cada persona con su ficha de
Odoo (servicios/organizacion.py). Confirmarlo o deshacerlo solo se puede con la clave secreta
(public.confirmar_vinculo_odoo / deshacer_vinculo_odoo), después de comprobar en Odoo que la ficha es una de las
propuestas; la función vuelve a comprobar en la base de datos los permisos de quien confirma, cuyo id se le pasa.
"""
from __future__ import annotations

import os

import httpx

from . import auth
from .errors import AppError


class _Servicio:
    """Marca para trabajar con la clave secreta. Es un objeto, no un texto: un token que llegue de fuera nunca puede serlo."""

    def __repr__(self) -> str:
        return "SERVICIO"


SERVICIO = _Servicio()


def clave_servicio() -> str:
    return (os.environ.get("SUPABASE_SECRET_KEY") or "").strip()


def _cliente() -> httpx.Client:
    return httpx.Client(timeout=10)


def _cabeceras(token) -> dict:
    if token is SERVICIO:
        clave = clave_servicio()
        if not clave:
            raise AppError("Falta configurar la clave de servidor de Supabase (SUPABASE_SECRET_KEY).", 503, "sin_clave_servidor")
        return {"apikey": clave, "Content-Type": "application/json"}
    if not isinstance(token, str) or not token:
        raise AppError("Tienes que iniciar sesión.", 401, "sin_sesion")
    _, clave = auth._supabase()
    return {"apikey": clave, "Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _url(tabla: str) -> str:
    url, _ = auth._supabase()
    return f"{url}/rest/v1/{tabla}"


class FaltaEnBase(AppError):
    """La tabla, la columna o la función no existen en Supabase: falta aplicar su migración. Es un AppError, así que
    quien ya capturaba AppError sigue igual; quien quiera distinguirlo (lo nuevo que se oculta sin su migración), lo
    captura aparte."""


# Respuestas de PostgREST cuando lo pedido no existe en la base de datos (función, tabla o columna).
CODIGOS_NO_EXISTE = {"PGRST202", "PGRST204", "PGRST205", "42703", "42883", "42P01"}


def _codigo(r: httpx.Response) -> str:
    try:
        datos = r.json()
    except ValueError:
        return ""
    return str(datos.get("code") or "") if isinstance(datos, dict) else ""


def _mensaje(r: httpx.Response) -> str:
    try:
        datos = r.json()
    except ValueError:
        return ""
    return str(datos.get("message") or "") if isinstance(datos, dict) else ""


def leer(token, tabla: str, params: dict) -> list[dict]:
    try:
        with _cliente() as http:
            r = http.get(_url(tabla), headers=_cabeceras(token), params=params)
            if r.status_code >= 400 and _codigo(r) in CODIGOS_NO_EXISTE:
                raise FaltaEnBase("No se han podido leer los datos. Inténtalo de nuevo.", 503, "falta_migracion")
            r.raise_for_status()
            return r.json()
    except httpx.HTTPError:
        raise AppError("No se han podido leer los datos. Inténtalo de nuevo.", 503, "sin_conexion_datos")


# Avisos que las funciones de la base de datos ya escriben para la pantalla (permiso, dato no válido, duplicado,
# momento no permitido). Cualquier otro error sale con un texto general.
CODIGOS_CON_AVISO = {"42501": 403, "22023": 400, "23505": 409, "55000": 409}


def llamar(token, funcion: str, argumentos: dict, general: str = "No se ha podido guardar. Inténtalo de nuevo."):
    """Llama a una función de la base de datos (POST /rest/v1/rpc/<funcion>) y devuelve lo que responde."""
    try:
        with _cliente() as http:
            r = http.post(_url(f"rpc/{funcion}"), headers=_cabeceras(token), json=argumentos)
    except httpx.HTTPError:
        raise AppError(general, 503, "sin_conexion_datos")
    if r.status_code < 400:
        try:
            return r.json() if r.content else None
        except ValueError:
            return None
    codigo = _codigo(r)
    if codigo in CODIGOS_NO_EXISTE:
        raise FaltaEnBase(general, 503, "falta_migracion")
    if codigo in CODIGOS_CON_AVISO and _mensaje(r):
        raise AppError(_mensaje(r), CODIGOS_CON_AVISO[codigo], "rechazado")
    raise AppError(general, 503, "sin_conexion_datos")


def actualizar(token, tabla: str, filtro: dict, datos: dict) -> int:
    """Devuelve cuántas filas ha cambiado (las reglas RLS pueden dejarlo en 0 sin dar error)."""
    try:
        with _cliente() as http:
            r = http.patch(_url(tabla), headers={**_cabeceras(token), "Prefer": "return=representation"},
                           params={**filtro, "select": "id"}, json=datos)
            r.raise_for_status()
            return len(r.json() or [])
    except (httpx.HTTPError, ValueError):
        raise AppError("No se han podido guardar los datos. Inténtalo de nuevo.", 503, "sin_conexion_datos")


def insertar(token, tabla: str, filas: list[dict] | dict, conflicto: str | None = None) -> None:
    """Alta de filas. Con `conflicto` (columna única) actualiza la fila que ya exista."""
    params = {"on_conflict": conflicto} if conflicto else {}
    prefer = "return=minimal" + (",resolution=merge-duplicates" if conflicto else "")
    try:
        with _cliente() as http:
            r = http.post(_url(tabla), headers={**_cabeceras(token), "Prefer": prefer}, params=params, json=filas)
            r.raise_for_status()
    except httpx.HTTPError:
        raise AppError("No se han podido guardar los datos. Inténtalo de nuevo.", 503, "sin_conexion_datos")
