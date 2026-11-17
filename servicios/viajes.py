"""«Mis viajes»: las órdenes de transporte de Odoo de cada chófer y los pasos de carga y descarga que marca en la app.

- Las órdenes se leen de Odoo en directo, solo lectura (OdooClient.ordenes_de_conductores, dominio fijo).
- El contacto conductor sale SIEMPRE del enlace confirmado por su encargado (public.usuarios.odoo_conductor_id), leído
  con la sesión de quien mira; nunca llega del navegador.
- Los pasos (cargando, descargado…) se guardan solo en Supabase (public.viajes_estados); no van a Odoo.
Detalle en docs/viajes.md. Las rutas están en servicios/chofer.py.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from . import supa
from .auth import Usuario
from .config import get_settings
from .errors import AppError
from .odoo_client import OdooClient

MADRID = ZoneInfo("Europe/Madrid")
EMPRESAS_DECA = {1: "stinsa", 7: "transargi"}       # las que DECA sabe abrir (servicios/service.py COMPANIES)
PASOS = ["llegada_carga", "cargando", "cargado", "llegada_descarga", "descargando", "descargado"]   # = src/lib/viajes.ts
DIAS_EN_CURSO_CHOFER = 30       # un viaje empezado y sin descargar se sigue enseñando hasta 30 días
DIAS_EN_CURSO_SEGUIMIENTO = 10
LIMITE_CHOFER = 40
LIMITE_SEGUIMIENTO = 500
# Horas en un mismo paso a partir de las que tráfico ve un aviso.
HORAS_AVISO = {"llegada_carga": 2, "cargando": 3, "cargado": 48, "llegada_descarga": 2, "descargando": 3}
HORAS_SIN_EMPEZAR = 2           # sin ningún paso cuando ya pasaron 2 h del inicio previsto
SIN_ENLACE = "Tu encargado tiene que confirmar tu ficha de Odoo. Cuando lo haga, aquí verás tus viajes."


@contextmanager
def conexion():
    s = get_settings()
    if s.mode != "real":
        raise AppError("«Mis viajes» necesita la conexión real con Odoo. No se muestran datos de ejemplo.", 503, "odoo_no_configurado")
    c = OdooClient(s)
    try:
        yield c
    finally:
        c._http.close()
        c._anon.close()


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def _hoy():
    return datetime.now(MADRID).date()


def _sesion(u: Usuario) -> str:
    if not u.token:
        raise AppError("Tienes que iniciar sesión.", 401, "sin_sesion")
    return u.token


def _nombre(valor) -> str | None:
    return valor[1] if isinstance(valor, (list, tuple)) and len(valor) == 2 and valor[1] else None


def _id(valor) -> int | None:
    return valor[0] if isinstance(valor, (list, tuple)) and len(valor) == 2 else None


def _utc(texto) -> str | None:
    """«AAAA-MM-DD HH:MM:SS» de Odoo (UTC) → ISO con zona, para que la pantalla lo enseñe en hora de Madrid."""
    if not isinstance(texto, str) or len(texto) < 10:
        return None
    try:
        return datetime.fromisoformat(texto.replace(" ", "T")).replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        return None


def _momento(texto) -> datetime | None:
    try:
        return datetime.fromisoformat(str(texto).replace("Z", "+00:00"))
    except ValueError:
        return None


def ficha_orden(t: dict) -> dict:
    """Lo que ve el chófer de una orden. Solo datos de la propia orden (sin precios ni datos de facturación)."""
    empresa = _id(t.get("company_id"))
    return {
        "id": t["id"], "nombre": t.get("name") or "", "pedido": _nombre(t.get("sale_order_id")),
        "empresa": EMPRESAS_DECA.get(empresa), "empresa_nombre": _nombre(t.get("company_id")),
        "cliente": _nombre(t.get("partner_id")),
        "origen": _nombre(t.get("shipping_origin_id")), "destino": _nombre(t.get("shipping_destination_id")),
        "destino_final": _nombre(t.get("final_destination_id")),
        "puerto_carga": _nombre(t.get("loading_port_id")), "puerto_descarga": _nombre(t.get("unloading_port_id")),
        "inicio": _utc(t.get("planned_date_start")), "fin": _utc(t.get("planned_date_end")), "limite": _utc(t.get("date_deadline")),
        "referencia_carga": t.get("load_reference") or None, "referencia_cliente": t.get("client_order_ref") or None,
        "remolque": _nombre(t.get("trailer_id")), "servicio_descarga": bool(t.get("unload_service")),
        "emitida": _utc(t.get("tms_transport_order_creation_date")), "aprobada": t.get("state") == "03_approved",
        "etapa": _nombre(t.get("stage_id")),
    }


def siguiente_paso(pasos: list[dict]) -> str | None:
    """El paso que toca después de los ya marcados (las incidencias no cuentan). None: ya está descargado."""
    hechos = [p["estado"] for p in pasos if p.get("estado") in PASOS]
    if not hechos:
        return PASOS[0]
    i = PASOS.index(hechos[-1])
    return PASOS[i + 1] if i + 1 < len(PASOS) else None


def conductor_enlazado(u: Usuario) -> int | None:
    """Contacto conductor de Odoo de quien mira, solo si su encargado ha confirmado el enlace."""
    filas = supa.leer(_sesion(u), "usuarios", {"id": f"eq.{u.id}", "select": "odoo_conductor_id,vinculo_confirmado", "limit": "1"})
    f = filas[0] if filas else {}
    c = f.get("odoo_conductor_id")
    return int(c) if isinstance(c, int) and c > 0 and f.get("vinculo_confirmado") else None


def _orden_chofer(orden: dict) -> tuple:
    """Primero lo empezado sin descargar, luego lo pendiente por fecha prevista y al final lo descargado."""
    grupo = 2 if orden["terminado"] else 0 if orden["pasos"] else 1
    return grupo, orden["inicio"] or orden["emitida"] or "9999", orden["id"]


def mis_viajes(u: Usuario) -> dict:
    token = _sesion(u)
    conductor = conductor_enlazado(u)
    consultado = _ahora().isoformat()
    if conductor is None:
        return {"enlazado": False, "aviso": SIN_ENLACE, "ordenes": [], "limitado": False, "consultado": consultado}
    desde = (_ahora() - timedelta(days=DIAS_EN_CURSO_CHOFER)).isoformat()
    try:
        empezadas = supa.leer(token, "rpc/viajes_en_curso", {"desde": desde, "persona": u.id})
    except AppError:
        raise AppError("«Mis viajes» no está preparado: falta aplicar su migración en Supabase. Avisa a administración.",
                       503, "viajes_sin_configurar")
    en_curso = [f["odoo_task_id"] for f in empezadas if f.get("usuario_id") == u.id]
    with conexion() as c:
        filas = c.ordenes_de_conductores([conductor], _hoy(), en_curso, LIMITE_CHOFER)
    limitado = len(filas) > LIMITE_CHOFER
    ordenes = [ficha_orden(t) for t in filas[:LIMITE_CHOFER]]
    pasos: dict[int, list[dict]] = {}
    if ordenes:
        for p in supa.leer(token, "viajes_estados", {
                "usuario_id": f"eq.{u.id}", "odoo_task_id": f"in.({','.join(str(o['id']) for o in ordenes)})",
                "select": "odoo_task_id,estado,nota,momento", "order": "momento.asc,id.asc", "limit": "2000"}):
            pasos.setdefault(p["odoo_task_id"], []).append({"estado": p["estado"], "nota": p.get("nota"), "momento": p["momento"]})
    for o in ordenes:
        o["pasos"] = pasos.get(o["id"], [])
        o["siguiente"] = siguiente_paso(o["pasos"])
        o["terminado"] = o["siguiente"] is None
    ordenes.sort(key=_orden_chofer)
    return {"enlazado": True, "aviso": None, "ordenes": ordenes, "limitado": limitado, "consultado": consultado,
            "origen": "Odoo · Órdenes de transporte"}


def comprobar_orden(u: Usuario, tarea: int) -> dict:
    """¿Esta orden le ha llegado a quien mira y sigue abierta? Lo usa la web antes de guardar un paso."""
    conductor = conductor_enlazado(u)
    if conductor is None:
        raise AppError(SIN_ENLACE, 409, "sin_enlace")
    with conexion() as c:
        t = c.orden_de_conductor(conductor, tarea)
    if not t:
        raise AppError("Esa orden ya no está entre tus viajes abiertos. Recarga la pantalla.", 404, "orden_no_es_tuya")
    return {"orden": ficha_orden(t)}


def aviso_seguimiento(orden: dict, ultimo: dict | None, ahora: datetime) -> str | None:
    """Aviso para tráfico si un viaje lleva mucho en el mismo paso o no ha empezado a su hora."""
    if ultimo and ultimo.get("estado") in HORAS_AVISO:
        m = _momento(ultimo.get("momento"))
        if m and ahora - m >= timedelta(hours=HORAS_AVISO[ultimo["estado"]]):
            horas = int((ahora - m).total_seconds() // 3600)
            return f"Lleva {horas} h en este paso"
        return None
    if not ultimo or not ultimo.get("estado"):
        inicio = _momento(orden.get("inicio")) if orden.get("inicio") else None
        if inicio and ahora - inicio >= timedelta(hours=HORAS_SIN_EMPEZAR):
            return "No ha marcado la llegada a carga"
    return None


def seguimiento(u: Usuario) -> dict:
    """Órdenes abiertas de los chóferes que sigue quien mira (lo decide Supabase con su sesión) y su último paso."""
    token = _sesion(u)
    consultado = _ahora().isoformat()
    try:
        personas = supa.leer(token, "rpc/viajes_conductores_a_mi_cargo", {})
    except AppError:
        raise AppError("El seguimiento de viajes no está preparado: falta aplicar su migración en Supabase. Avisa a administración.",
                       503, "viajes_sin_configurar")
    vacio = {"personas": [], "ordenes": [], "limitado": False, "consultado": consultado, "origen": "Odoo · Órdenes de transporte"}
    personas = [p for p in personas if isinstance(p.get("odoo_conductor_id"), int) and p["odoo_conductor_id"] > 0]
    if not personas:
        return vacio
    por_conductor = {p["odoo_conductor_id"]: p for p in personas}
    ids_personas = {p["id"] for p in personas}
    desde = (_ahora() - timedelta(days=DIAS_EN_CURSO_SEGUIMIENTO)).isoformat()
    en_curso = [f["odoo_task_id"] for f in supa.leer(token, "rpc/viajes_en_curso", {"desde": desde})
                if f.get("usuario_id") in ids_personas]
    with conexion() as c:
        filas = c.ordenes_de_conductores(sorted(por_conductor), _hoy(), en_curso, LIMITE_SEGUIMIENTO)
    limitado = len(filas) > LIMITE_SEGUIMIENTO
    filas = filas[:LIMITE_SEGUIMIENTO]
    ultimos: dict[tuple[str, int], dict] = {}
    if filas:
        for f in supa.leer(token, "rpc/viajes_ultimo_estado", {"tareas": "{" + ",".join(str(t["id"]) for t in filas) + "}"}):
            ultimos[(f["usuario_id"], f["odoo_task_id"])] = f
    ahora = _ahora()
    ordenes = []
    for t in filas:
        persona = por_conductor.get(_id(t.get("driver_id")))
        if not persona:
            continue
        orden = ficha_orden(t)
        u_paso = ultimos.get((persona["id"], t["id"]))
        orden.update({
            "persona": {"id": persona["id"], "nombre": persona.get("nombre") or "Sin nombre"},
            "estado": (u_paso or {}).get("estado"), "momento": (u_paso or {}).get("momento"),
            "incidencias": int((u_paso or {}).get("incidencias") or 0),
            "ultima_incidencia": (u_paso or {}).get("ultima_incidencia"), "nota": (u_paso or {}).get("nota"),
        })
        orden["aviso"] = aviso_seguimiento(orden, u_paso if u_paso and u_paso.get("estado") else None, ahora)
        ordenes.append(orden)
    ordenes.sort(key=lambda o: (o["persona"]["nombre"], o["estado"] == "descargado", o["inicio"] or "9999", o["id"]))
    return {**vacio, "personas": [{"id": p["id"], "nombre": p.get("nombre") or "Sin nombre"} for p in personas],
            "ordenes": ordenes, "limitado": limitado}
