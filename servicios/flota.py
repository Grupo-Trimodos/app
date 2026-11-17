"""Consulta global de flota; permiso explícito, sin escrituras en Movildata ni Odoo."""
from datetime import date

from fastapi import APIRouter, Depends, Query

from . import movildata
from .auth import Usuario, requiere_permiso
from .errors import AppError

router = APIRouter(prefix="/api/flota", tags=["flota"])


def _sesion_real(u: Usuario):
    # El acceso local de prueba de DECA nunca permite leer una clave real de flota.
    if not u.token:
        raise AppError("Tienes que iniciar sesión.", 401, "sin_sesion")


@router.get("/resumen")
def resumen(u: Usuario = Depends(requiere_permiso(("flota.ver", "direccion.ver")))):   # el cuadro de mando enseña el resumen
    _sesion_real(u)
    return movildata.resumen_flota()


@router.get("/vehiculos/{matricula}/recorrido")
def recorrido(matricula: str, fecha: date = Query(...), u: Usuario = Depends(requiere_permiso("flota.ver"))):
    _sesion_real(u)
    try:
        return movildata.recorrido(matricula, fecha)
    except ValueError as e:
        raise AppError(str(e), 400, "fecha_invalida") from None
    except LookupError as e:
        raise AppError(str(e), 404, "vehiculo_no_disponible") from None
    except movildata.MovildataError as e:
        raise AppError(str(e), 503, "movildata_no_disponible") from None


@router.get("/catalogo-odoo")
def catalogo_odoo(buscar: str = Query("", max_length=100), externos: bool = False, u: Usuario = Depends(requiere_permiso("transporte.ver"))):
    _sesion_real(u)
    from .config import get_settings
    from .odoo_client import OdooClient
    if externos and not u.puede("transporte.externos"):
        raise AppError("No tienes permiso para consultar el catálogo de transporte externo.", 403, "sin_permiso")
    s = get_settings()
    if s.mode != "real":
        raise AppError("La consulta de chóferes y vehículos necesita la conexión real con Odoo.", 503, "odoo_no_configurado")
    cliente = OdooClient(s)
    try:
        return cliente.catalogo_transporte(buscar.strip(), incluir_externos=externos)
    finally:
        cliente._http.close()
        cliente._anon.close()


@router.get("/avisos-asignacion")
def avisos_asignacion(u: Usuario = Depends(requiere_permiso("transporte.ver"))):
    """Camiones propios sin chófer y chóferes del grupo sin camión, leídos de Odoo en directo (solo lectura)."""
    _sesion_real(u)
    from .config import get_settings
    from .odoo_client import OdooClient
    s = get_settings()
    if s.mode != "real":
        raise AppError("Los avisos de chóferes y camiones necesitan la conexión real con Odoo.", 503, "odoo_no_configurado")
    cliente = OdooClient(s)
    try:
        return cliente.avisos_asignacion_flota()
    finally:
        cliente._http.close()
        cliente._anon.close()
