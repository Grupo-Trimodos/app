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

# Edición autorizada el 17-11-2026. La cola conserva la intención y el resultado; Odoo conserva la ficha.
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class DatosFicha(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: str = Field(min_length=1, max_length=200)
    mobile_phone: str = Field(max_length=80)
    work_phone: str = Field(max_length=80)
    work_email: str = Field(max_length=254)
    work_location_id: int | None = Field(ge=1)
    department_id: int | None = Field(ge=1)
    job_id: int | None = Field(ge=1)
    parent_id: int | None = Field(ge=1)


class EdicionFicha(BaseModel):
    model_config = ConfigDict(extra="forbid")
    solicitud: UUID
    version: str = Field(min_length=1, max_length=80)
    datos: DatosFicha
    real: bool = False


def comprobar_editor(u):
    if not u.puede("admin.usuarios"):
        raise AppError("Necesitas permiso para gestionar las cuentas.", 403, "sin_permiso")


@router.get("/empleados/{empleado}/edicion")
def leer_edicion(empleado: int, u: Usuario = Depends(requiere_permiso("organizacion.editar"))):
    comprobar_editor(u)
    with conexion(u) as c:
        ficha = c.ficha_editable_empleado(empleado)
        opciones = c.opciones_edicion_empleado(ficha["empresa"])
    try:
        historial = supa.leer(u.token, "odoo_ediciones_empleados", {"empleado_id": f"eq.{empleado}", "select": "id,creado,estado,error", "order": "creado.desc", "limit": "10"})
    except AppError:
        raise AppError("La edición no está preparada: comprueba la migración de la cola de fichas en Supabase.", 503, "edicion_sin_configurar")
    return {**ficha, "opciones": opciones, "historial": historial}


@router.post("/empleados/{empleado}/edicion")
def guardar_edicion(empleado: int, body: EdicionFicha, u: Usuario = Depends(requiere_permiso("organizacion.editar"))):
    comprobar_editor(u)
    if not u.token:
        raise AppError("Tienes que iniciar sesión.", 401)
    # Si falta la migración, falla aquí: nunca se escribe directamente en Odoo como alternativa.
    existentes = supa.leer(u.token, "odoo_ediciones_empleados", {"id": f"eq.{body.solicitud}", "select": "id,autor,empleado_id,estado,error"})
    if existentes:
        f = existentes[0]
        if f["autor"] != u.id or f["empleado_id"] != empleado:
            raise AppError("La solicitud no corresponde a esta ficha.", 409)
        if f["estado"] == "pendiente":
            from .sincronizacion import enviar_edicion_empleado
            return enviar_edicion_empleado(str(body.solicitud))
        return {"estado": f["estado"], "error": f.get("error"), "id": f["id"]}
    with conexion(u) as c:
        antes = c.ficha_editable_empleado(empleado)
    if antes["version"] != body.version:
        raise AppError("La ficha ha cambiado en Odoo. Vuelve a cargarla antes de guardar.", 409)
    valores = {k: (v.strip() if isinstance(v, str) else v or False) for k, v in body.datos.model_dump().items()}
    if not valores["name"]:
        raise AppError("El nombre no puede quedar vacío.", 400)
    cambios = {k: v for k, v in valores.items() if v != antes["valores"][k]}
    if not cambios:
        return {"estado": "sin_cambios", "error": None, "id": str(body.solicitud)}
    supa.insertar(supa.SERVICIO, "odoo_ediciones_empleados", {
        "id": str(body.solicitud), "autor": u.id, "empleado_id": empleado,
        "antes": antes, "cambios": cambios, "modo": "real" if body.real else "prueba"})
    from .sincronizacion import enviar_edicion_empleado
    return enviar_edicion_empleado(str(body.solicitud))
