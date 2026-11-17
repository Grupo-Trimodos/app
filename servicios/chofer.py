"""Datos de Movildata para la pantalla del chófer y sus órdenes de transporte («Mis viajes», servicios/viajes.py).
Las asignaciones, los fichajes y los pasos de carga y descarga los guarda la web en Supabase."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Path

from . import movildata, supa, viajes
from .auth import Usuario, requiere_permiso
from .errors import AppError

router = APIRouter(prefix="/api/chofer", tags=["chofer"])


@router.get("/hoy")
def hoy(u: Usuario = Depends(requiere_permiso("chofer.usar"))):
    if movildata.modo() == "real" and not u.token:
        raise AppError("Tienes que iniciar sesión.", 401, "sin_sesion")
    vehiculos = supa.leer(u.token, "vehiculos", {"activo": "eq.true", "select": "id,matricula"}) if u.token else []
    resultado = {
        "modo": movildata.modo(),
        "simulado": movildata.modo() == "mock",
        "tarjeta": movildata.tarjeta_en_camion(u.id, vehiculos),
        "resumen": movildata.resumen_dia(u.id),
        "vehiculo": None,
        "aviso": None,
    }
    if resultado["simulado"]:
        return resultado
    asignaciones = supa.leer(u.token, "asignaciones", {"usuario_id": f"eq.{u.id}", "fin": "is.null",
                            "select": "vehiculo_id", "order": "inicio.desc", "limit": "1"})
    asignado = next((v for v in vehiculos if asignaciones and v["id"] == asignaciones[0].get("vehiculo_id")), None)
    if not asignado:
        return {**resultado, "aviso": "Confirma tu camión para ver sus datos de Movildata."}
    flota = movildata.resumen_flota()
    mid = movildata.matricula_id(asignado["matricula"])
    vehiculo = next((v for v in flota["vehiculos"] if v["id"] == mid), None)
    aviso = " ".join(flota["avisos"]) or (None if vehiculo else "Tu camión no devuelve datos en Movildata en este momento.")
    # Nunca devolver datos de otros vehículos ni atribuir datos del vehículo al tacógrafo del conductor.
    return {**resultado, "vehiculo": vehiculo, "aviso": aviso}


# ---- «Mis viajes» (servicios/viajes.py, docs/viajes.md) ----------------------------------------------------------
# El contacto conductor sale del enlace guardado en Supabase de quien mira; ninguna ruta lo acepta desde fuera.
@router.get("/viajes")
def mis_viajes(u: Usuario = Depends(requiere_permiso("viajes.usar"))):
    return viajes.mis_viajes(u)


@router.get("/viajes/seguimiento")   # antes que /viajes/{tarea}
def seguimiento_viajes(u: Usuario = Depends(requiere_permiso("viajes.seguimiento"))):
    return viajes.seguimiento(u)


@router.get("/viajes/{tarea}")
def comprobar_viaje(tarea: int = Path(gt=0, lt=2**31), u: Usuario = Depends(requiere_permiso("viajes.usar"))):
    """Para la web, antes de guardar un paso: ¿esta orden es de quien mira y sigue abierta?"""
    return viajes.comprobar_orden(u, tarea)
