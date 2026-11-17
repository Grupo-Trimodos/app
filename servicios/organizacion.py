"""Organización de Odoo en lectura. Los nombres orientan; solo los IDs prueban un enlace.
Las propuestas nunca cambian pertenencias ni conceden permisos.
"""
from datetime import datetime, timezone
from contextlib import contextmanager
import unicodedata

from fastapi import APIRouter, Depends

from .auth import Usuario, requiere_permiso
from .config import get_settings
from .errors import AppError
from .odoo_client import OdooClient
from . import supa

router = APIRouter(prefix="/api/odoo", tags=["organizacion"])


@contextmanager
def conexion(u: Usuario):
    if not u.token:
        raise AppError("Tienes que iniciar sesión.", 401, "sin_sesion")
    s = get_settings()
    if s.mode != "real":
        raise AppError("La organización necesita la conexión real con Odoo. No se muestran datos de ejemplo.", 503, "odoo_no_configurado")
    c = OdooClient(s)
    try:
        yield c
    finally:
        c._http.close()
        c._anon.close()


def normalizar(texto):
    return " ".join("".join(c for c in unicodedata.normalize("NFKD", texto.casefold())
                            if not unicodedata.combining(c)).split())


def relacionar_centros(centros, estructura):
    """Candidatos revisables, sin escoger entre homónimos ni sustituir un ID inexistente."""
    resultado = []
    for centro in centros:
        nombre = centro["nombre"]
        clave = normalizar(nombre)
        enlace = centro.get("odoo_ubicacion_id")
        modelo = "hr.work.location"
        lista = estructura["ubicaciones"]
        if enlace:
            candidatos = [x for x in lista if x["id"] == enlace]
            estado = "Vinculado por identificador" if candidatos else "Vínculo no disponible en Odoo"
        else:
            if clave.startswith("montaje "):
                clave = "almacen " + clave.removeprefix("montaje ")
                modelo = "hr.department"
                lista = estructura["departamentos"]
            elif clave.startswith("oficina "):
                clave = clave.removeprefix("oficina ")
            candidatos = [x for x in lista if normalizar(x["name"]) == clave]
            estado = "Propuesta por nombre · confirmar" if len(candidatos) == 1 else (
                "Varias coincidencias · confirmar" if candidatos else "Sin relación confirmada")
        resultado.append({"id": centro["id"], "nombre": nombre, "estado": estado, "modelo": modelo,
                          "candidatos": [{"id": x["id"], "nombre": x["name"],
                            "empresa": x["company_id"][1] if x.get("company_id") else "Compartido"} for x in candidatos]})
    return resultado


@router.get("/organizacion")
def organizacion(u: Usuario = Depends(requiere_permiso("organizacion.ver"))):
    with conexion(u) as c:
        estructura = c.estructura_organizacion()
    aviso = None
    try:
        centros = supa.leer(u.token, "centros", {"select": "id,nombre,odoo_ubicacion_id", "activo": "eq.true"})
    except AppError:
        centros = []
        aviso = "No se han podido comprobar los vínculos con los centros de la app. Revisa la conexión y la migración de grupos de trabajo."
    return {**estructura, "relaciones": relacionar_centros(centros, estructura), "aviso": aviso,
            "consultado": datetime.now(timezone.utc).isoformat(), "origen": "Odoo · Empleados"}


@router.get("/mi-organizacion")
def mi_organizacion(u: Usuario = Depends(requiere_permiso(None))):
    if not u.token:
        raise AppError("Tienes que iniciar sesión.", 401, "sin_sesion")
    filas = supa.leer(u.token, "usuarios", {"id": f"eq.{u.id}", "select": "odoo_employee_id", "limit": "1"})
    empleado = filas[0].get("odoo_employee_id") if filas else None
    if not empleado:
        return {"ficha": None, "aviso": "Tu cuenta todavía no está vinculada con tu ficha de Odoo. Administración puede revisar el vínculo."}
    with conexion(u) as c:
        ficha = c.organizacion_personal(int(empleado))
    return {"ficha": ficha, "aviso": None if ficha else "Tu ficha no está disponible en las empresas configuradas.",
            "consultado": datetime.now(timezone.utc).isoformat()}


@router.get("/mapa-empleados")
def mapa_empleados(u: Usuario = Depends(requiere_permiso("admin.usuarios"))):
    with conexion(u) as c:
        datos = c.mapa_empleados()
    return {**datos, "consultado": datetime.now(timezone.utc).isoformat()}
