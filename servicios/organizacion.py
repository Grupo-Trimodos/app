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


# ---- Enlace de cada persona de la app con su ficha de Odoo (autorizado por Félix el 17-11-2026) -------------------
# Solo lectura de Odoo. Propone fichas: a quien entra con código y PIN, por el móvil que ha dado; a quien entra con
# Microsoft o Google, por su correo (lo mismo que busca odoo_client.buscar_empleado). Si no coincide nada, por nombre.
# Quien confirma es su responsable desde «Mi equipo → Enlazar con Odoo». La confirmación SOLO sale de aquí: se
# comprueba que la ficha es una de las que Odoo propone ahora para esa persona y se llama a la función de la base de
# datos con la clave de servidor, pasando el id de quien confirma (la función vuelve a comprobar sus permisos).
# Los teléfonos y correos de Odoo solo se comparan: nunca salen enteros de aquí. Solo teléfonos de empresa.
import re

from .odoo_client import CAMPOS_TELEFONO_EMPRESA, campo_correo_extra

PALABRAS_VACIAS = {"de", "del", "la", "las", "los", "y", "i", "el"}
CAMPOS_TELEFONO_EMPLEADO = CAMPOS_TELEFONO_EMPRESA   # mobile_phone y work_phone; nunca private_phone
CAMPOS_TELEFONO_CONDUCTOR = ("mobile", "phone")
CAMPOS_CORREO_CONDUCTOR = ("email",)
MAX_POR_NOMBRE = 3
SIN_MIGRACION = "El enlace con Odoo no está preparado: falta aplicar su migración en Supabase. Avisa a administración."
SIN_DATOS = "No se ha podido consultar la app. Inténtalo de nuevo en un momento."


def normalizar_telefono(texto) -> str | None:
    """Igual que privado.normalizar_telefono en Supabase: solo dígitos y con el prefijo del país (34 para España)."""
    t = re.sub(r"[\s().·/\-]", "", str(texto or "").replace(" ", ""))
    if re.fullmatch(r"\+\d+", t):
        t = t[1:]
    elif re.fullmatch(r"00\d+", t):
        t = t[2:]
    elif re.fullmatch(r"[6789]\d{8}", t):
        t = "34" + t
    elif not re.fullmatch(r"34[6789]\d{8}", t):
        return None
    if not re.fullmatch(r"[1-9]\d{7,14}", t) or (t.startswith("34") and not re.fullmatch(r"34[6789]\d{8}", t)):
        return None
    return t


def final_guardado(t) -> str | None:
    """Últimas 9 cifras del móvil guardado en la app. Ya está normalizado (solo cifras, con el prefijo del país): no se
    vuelve a pasar por normalizar_telefono, que rechazaría un número extranjero sin su «+»."""
    return t[-9:] if isinstance(t, str) and t.isdigit() and len(t) >= 9 else None


def finales_telefono(texto) -> set[str]:
    """Últimas 9 cifras de cada número escrito en un campo de Odoo (a veces hay dos: «612… / 698…»)."""
    if not isinstance(texto, str):
        return set()
    partes = re.split(r"[/,;|]|\s[-–]\s|\s(?:o|y)\s", texto)
    return {d[-9:] for d in (re.sub(r"\D", "", p) for p in partes) if len(d) >= 9}


def correo_limpio(texto) -> str | None:
    """Correo para comparar: sin espacios y sin mayúsculas (como el «=ilike» de buscar_empleado)."""
    t = texto.strip().casefold() if isinstance(texto, str) else ""
    return t if "@" in t else None


def formato_telefono(t: str | None) -> str | None:
    if not t:
        return None
    if re.fullmatch(r"34\d{9}", t):
        return f"+34 {t[2:5]} {t[5:8]} {t[8:]}"
    return f"+{t}"


def palabras_nombre(nombre) -> set[str]:
    limpio = re.sub(r"[^\w\s]", " ", normalizar(str(nombre or "")))
    return {p for p in limpio.split() if len(p) > 1 and p not in PALABRAS_VACIAS}


def parecido_nombre(a, b) -> float:
    """Proporción de palabras comunes (al menos dos) sobre el nombre más corto. 1 = mismas palabras en otro orden."""
    pa, pb = palabras_nombre(a), palabras_nombre(b)
    comunes = len(pa & pb)
    return comunes / min(len(pa), len(pb)) if comunes >= 2 else 0.0


def _indice_telefonos(registros, campos) -> dict[str, list[int]]:
    indice: dict[str, list[int]] = {}
    for r in registros:
        for n in set().union(*(finales_telefono(r.get(c)) for c in campos)):
            indice.setdefault(n, []).append(r["id"])
    return indice


def _indice_correos(registros, campos) -> dict[str, list[int]]:
    indice: dict[str, list[int]] = {}
    for r in registros:
        for correo in {correo_limpio(r.get(c)) for c in campos} - {None}:
            indice.setdefault(correo, []).append(r["id"])
    return indice


def _ficha_empleado(e) -> dict:
    return {"id": e["id"], "nombre": e.get("name") or "Sin nombre",
            "empresa": _m2o_nombre(e.get("company_id")), "departamento": _m2o_nombre(e.get("department_id")),
            "puesto": _m2o_nombre(e.get("job_id"))}


def _ficha_conductor(c) -> dict:
    return {"id": c["id"], "nombre": c.get("name") or "Sin nombre",
            "empresa": _m2o_nombre(c.get("parent_id")) or _m2o_nombre(c.get("company_id")), "departamento": None, "puesto": None}


def _m2o_nombre(valor) -> str | None:
    return valor[1] if isinstance(valor, (list, tuple)) and len(valor) == 2 else None


def _aviso(c: dict) -> str | None:
    if c["ocupada"]:
        return "Ya está enlazada con otra persona de la app."
    if c["compartido"]:
        return ("Este teléfono está en varias fichas de Odoo: compruébalo." if c["por"] == "telefono"
                else "Este correo está en varias fichas de Odoo: compruébalo.")
    if c["por"] == "telefono" and c["movil_repetido"]:
        return "Este móvil lo han dado varias personas de la app: compruébalo."
    if c["por"] in ("telefono", "correo") and not c["nombre_parecido"]:
        return "El nombre no coincide: compruébalo."
    if c["descartada"]:
        return "Es la ficha que se quitó al deshacer su enlace: compruébalo."
    if c["por"] == "nombre":
        return "Por nombre, compruébalo."
    if c["por"] == "actual":
        return "Enlace puesto sin confirmar (por correo, código o en Administración): compruébalo."
    return None


def _candidatos(persona: dict, actual: int | None, registros: list[dict], ind_tel: dict, ind_correo: dict,
                ocupados: set[int], ficha, rechazada: int | None = None) -> list[dict]:
    por_id = {r["id"]: r for r in registros}
    salida: list[dict] = []
    if persona.get("con_pin"):   # entra con código y PIN: por el móvil que ha dado
        final = final_guardado(persona.get("telefono"))
        coinciden = ind_tel.get(final, []) if final else []
        salida += [{**ficha(por_id[i]), "por": "telefono", "telefono_fin": final[-3:], "compartido": len(coinciden) > 1}
                   for i in coinciden]
    else:                        # entra con Microsoft o Google: por su correo
        correo = correo_limpio(persona.get("correo"))
        coinciden = ind_correo.get(correo, []) if correo else []
        salida += [{**ficha(por_id[i]), "por": "correo", "telefono_fin": None, "compartido": len(coinciden) > 1}
                   for i in coinciden]
    if not salida:
        parecidos = sorted(((parecido_nombre(persona.get("nombre"), r.get("name")), r) for r in registros), key=lambda x: (-x[0], x[1]["id"]))
        salida += [{**ficha(r), "por": "nombre", "telefono_fin": None, "compartido": False}
                   for p, r in parecidos[:MAX_POR_NOMBRE] if p >= 2 / 3]
    if actual and actual not in {c["id"] for c in salida}:
        base = ficha(por_id[actual]) if actual in por_id else {
            "id": actual, "nombre": "Ficha no encontrada entre las activas de Odoo", "empresa": None, "departamento": None, "puesto": None}
        salida.insert(0, {**base, "por": "actual", "telefono_fin": None, "compartido": False, "disponible": actual in por_id})
    for c in salida:
        c.setdefault("disponible", True)
        c["actual"] = c["id"] == actual
        c["ocupada"] = c["id"] in ocupados and c["id"] != actual
        c["descartada"] = rechazada is not None and c["id"] == rechazada
        c["movil_repetido"] = bool(persona.get("telefono_repetido"))
        c["nombre_parecido"] = parecido_nombre(persona.get("nombre"), c["nombre"]) > 0
        # Seguro (se marca solo): una sola ficha con su móvil o su correo, libre, con un nombre parecido, no descartada y
        # con un móvil que no ha dado nadie más en la app (el móvil lo escribe la persona sin verificar).
        c["seguro"] = (c["por"] in ("telefono", "correo") and not c["compartido"] and not c["ocupada"] and c["nombre_parecido"]
                       and not c["descartada"] and not (c["por"] == "telefono" and c["movil_repetido"]))
        c["aviso"] = _aviso(c)
        del c["movil_repetido"], c["nombre_parecido"]
    return salida


def elegible(c: dict) -> bool:
    """Se puede elegir: está activa en Odoo y no la tiene otra persona de la app (igual que en la pantalla)."""
    return bool(c.get("disponible")) and not c.get("ocupada")


def proponer_vinculos(personas: list[dict], empleados: list[dict], conductores: list[dict], ocupadas: list[dict]) -> dict:
    """Para cada persona sin enlace confirmado, sus fichas de empleado y contactos conductores candidatos. Por su móvil
    (últimas 9 cifras, solo quien entra con PIN) o su correo (quien entra con Microsoft o Google) y, si no hay ninguno,
    por nombre parecido. Sin teléfonos ni correos de Odoo: como mucho, las 3 últimas cifras del teléfono."""
    extra = campo_correo_extra()
    ind_emp_tel = _indice_telefonos(empleados, CAMPOS_TELEFONO_EMPLEADO)
    ind_emp_correo = _indice_correos(empleados, ("work_email", *([extra] if extra else [])))
    ind_con_tel = _indice_telefonos(conductores, CAMPOS_TELEFONO_CONDUCTOR)
    ind_con_correo = _indice_correos(conductores, CAMPOS_CORREO_CONDUCTOR)
    emp_ocupados = {f["empleado"] for f in ocupadas if f.get("empleado")}
    con_ocupados = {f["conductor"] for f in ocupadas if f.get("conductor")}
    emp_por_id = {e["id"]: e for e in empleados}
    con_por_id = {c["id"]: c for c in conductores}
    pendientes, enlazadas = [], []
    for p in personas:
        con_pin = bool(p.get("con_pin"))
        base = {"id": p["id"], "nombre": p.get("nombre") or "Sin nombre", "chofer": bool(p.get("chofer")), "con_pin": con_pin,
                "telefono": formato_telefono(p.get("telefono")) if con_pin else None,
                "correo": None if con_pin else (p.get("correo") or None)}
        if p.get("confirmado"):
            emp, con = p.get("odoo_employee_id"), p.get("odoo_conductor_id")
            enlazadas.append({**base, "confirmado": p["confirmado"], "confirmado_por": p.get("confirmado_por"),
                "empleado": {**(_ficha_empleado(emp_por_id[emp]) if emp in emp_por_id else {
                    "id": emp, "nombre": "Ficha no encontrada entre las activas de Odoo"}), "disponible": emp in emp_por_id},
                "conductor": None if not con else {**(_ficha_conductor(con_por_id[con]) if con in con_por_id else {
                    "id": con, "nombre": "Contacto no encontrado entre los conductores activos de Odoo"}), "disponible": con in con_por_id}})
            continue
        pendientes.append({**base,
            "empleados": _candidatos(p, p.get("odoo_employee_id"), empleados, ind_emp_tel, ind_emp_correo, emp_ocupados,
                                     _ficha_empleado, p.get("vinculo_rechazado")),
            "conductores": _candidatos(p, p.get("odoo_conductor_id"), conductores, ind_con_tel, ind_con_correo, con_ocupados,
                                       _ficha_conductor)})
    return {"pendientes": pendientes, "enlazadas": enlazadas}


def _personas_y_ocupadas(u: Usuario) -> tuple[list[dict], list[dict]]:
    """Con la sesión de quien mira: Supabase decide a quién puede enlazar."""
    try:
        return supa.leer(u.token, "rpc/personas_para_vincular", {}), supa.leer(u.token, "rpc/fichas_odoo_enlazadas", {})
    except supa.FaltaEnBase:
        raise AppError(SIN_MIGRACION, 503, "vinculos_sin_configurar")
    except AppError:
        raise AppError(SIN_DATOS, 503, "sin_conexion_datos")


def _propuestas(u: Usuario) -> dict:
    if not u.token:
        raise AppError("Tienes que iniciar sesión.", 401, "sin_sesion")
    personas, ocupadas = _personas_y_ocupadas(u)
    if not personas:
        return {"pendientes": [], "enlazadas": []}
    with conexion(u) as c:
        empleados = c.empleados_para_vincular()
        conductores = c.conductores_para_vincular()
    return proponer_vinculos(personas, empleados, conductores, ocupadas)


def _con_clave_de_servidor(funcion: str, argumentos: dict, general: str) -> None:
    try:
        supa.llamar(supa.SERVICIO, funcion, argumentos, general)
    except supa.FaltaEnBase:
        raise AppError(SIN_MIGRACION, 503, "vinculos_sin_configurar")


@router.get("/vinculos/pendientes")
def vinculos_pendientes(u: Usuario = Depends(requiere_permiso("personas.vincular"))):
    """Personas que quien mira puede enlazar (lo decide Supabase con su sesión) y sus fichas candidatas de Odoo."""
    return {**_propuestas(u), "consultado": datetime.now(timezone.utc).isoformat(),
            "origen": "Odoo · Empleados y contactos conductores"}


class Confirmacion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    persona: UUID
    empleado: int = Field(ge=1)
    conductor: int | None = Field(default=None, ge=1)


class Deshacer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    persona: UUID


@router.post("/vinculos/confirmar")
def confirmar_vinculo(body: Confirmacion, u: Usuario = Depends(requiere_permiso("personas.vincular"))):
    """«Son la misma persona». Solo una ficha que Odoo propone AHORA para esa persona (activa, de las empresas
    configuradas y libre), y solo para una persona que quien confirma ve con su sesión. La base de datos comprueba otra
    vez sus permisos, que la ficha no la tenga nadie y que no tenga la jornada abierta en otra ficha, y lo anota."""
    datos = _propuestas(u)
    p = next((x for x in datos["pendientes"] if x["id"] == str(body.persona)), None)
    if not p:
        raise AppError("Esta persona ya no está pendiente o no está en tus centros. Recarga la página.", 409, "no_pendiente")
    if not any(c["id"] == body.empleado and elegible(c) for c in p["empleados"]):
        raise AppError("Esa ficha de empleado ya no se puede elegir. Recarga la página.", 409, "ficha_no_propuesta")
    if body.conductor is not None and not any(c["id"] == body.conductor and elegible(c) for c in p["conductores"]):
        raise AppError("Ese contacto conductor ya no se puede elegir. Recarga la página.", 409, "conductor_no_propuesto")
    _con_clave_de_servidor("confirmar_vinculo_odoo", {"autor": u.id, "persona": str(body.persona), "empleado": body.empleado,
                                                      "conductor": body.conductor},
                           "No se ha podido guardar el enlace. Inténtalo de nuevo.")
    return {"ok": True, "nombre": p["nombre"]}


@router.post("/vinculos/deshacer")
def deshacer_vinculo(body: Deshacer, u: Usuario = Depends(requiere_permiso("personas.vincular"))):
    """Deshacer un enlace confirmado de una persona que quien lo pide ve con su sesión. La ficha queda descartada: el
    enlace automático por correo o código no se la vuelve a poner."""
    if not u.token:
        raise AppError("Tienes que iniciar sesión.", 401, "sin_sesion")
    personas, _ = _personas_y_ocupadas(u)
    p = next((x for x in personas if x.get("id") == str(body.persona) and x.get("confirmado")), None)
    if not p:
        raise AppError("Esta persona no tiene un enlace confirmado o no está en tus centros. Recarga la página.", 409, "no_enlazada")
    _con_clave_de_servidor("deshacer_vinculo_odoo", {"autor": u.id, "persona": str(body.persona)},
                           "No se ha podido deshacer el enlace. Inténtalo de nuevo.")
    return {"ok": True, "nombre": p.get("nombre") or "Sin nombre"}
