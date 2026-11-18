"""Enlace de cada persona de la app con Odoo: normalización, propuestas (por móvil a quien entra con PIN, por correo a
quien entra con Microsoft o Google), permiso, que la confirmación solo salga del servidor tras validar contra Odoo y que
no salgan los teléfonos ni los correos de Odoo. Sin conexiones reales: Supabase y Odoo simulados."""
from contextlib import contextmanager
import json
import re

import httpx
import pytest
from fastapi.testclient import TestClient

from servicios.auth import Usuario
from servicios.errors import AppError
from servicios.main import app
from servicios.odoo_client import OdooClient
from servicios import organizacion as org
from servicios import supa


@pytest.mark.parametrize("texto, esperado", [
    ("612 34 56 78", "34612345678"), ("+34 612-345-678", "34612345678"), ("0034 (612) 345.678", "34612345678"),
    ("34612345678", "34612345678"), ("964 12 34 56", "34964123456"), ("+44 7700 900123", "447700900123"),
    ("612 345 678", "34612345678"),
    ("6123456789", None), ("12345", None), ("+34 512 345 678", None), ("abc", None), ("", None), (None, None), ("+34 6123", None),
])
def test_normalizar_telefono_igual_que_en_supabase(texto, esperado):
    # Mismos casos que scripts/prueba_vinculo_db.py prueba contra privado.normalizar_telefono.
    assert org.normalizar_telefono(texto) == esperado


def test_el_movil_guardado_no_se_vuelve_a_normalizar():
    # Ya está normalizado en la base de datos (sin «+»): un móvil extranjero no se pierde.
    assert org.final_guardado("447700900123") == "700900123"
    assert org.final_guardado("40721234567") == "721234567"
    assert org.final_guardado("34612345678") == "612345678"
    assert org.final_guardado(None) is None and org.final_guardado("+34612") is None


def test_finales_de_los_telefonos_de_odoo():
    assert org.finales_telefono("+34 612 34 56 78") == {"612345678"}
    assert org.finales_telefono("612345678 / 698 765 432") == {"612345678", "698765432"}
    assert org.finales_telefono("964 12 34") == set()
    assert org.finales_telefono(False) == set()   # Odoo devuelve False en los campos vacíos


def test_parecido_de_nombres():
    assert org.parecido_nombre("Juan García López", "GARCIA LOPEZ, JUAN") == 1
    assert org.parecido_nombre("José Núñez", "JOSE NUÑEZ PEREZ") == 1
    assert org.parecido_nombre("Juan", "Juan García") == 0          # una sola palabra común no basta
    assert org.parecido_nombre("Ana de la Rosa", "Rosa Martín") == 0


EMPLEADOS = [
    {"id": 10, "name": "GARCIA LOPEZ, JUAN", "company_id": [1, "STINSA"], "department_id": [3, "Tráfico"], "job_id": [4, "Conductor"],
     "work_phone": False, "mobile_phone": "+34 612 34 56 78", "work_email": False},
    {"id": 11, "name": "Centralita Uno", "company_id": [1, "STINSA"], "department_id": False, "job_id": False,
     "work_phone": "964 11 22 33", "mobile_phone": False, "work_email": False},
    {"id": 12, "name": "Centralita Dos", "company_id": [7, "TRANSARGI"], "department_id": False, "job_id": False,
     "work_phone": "+34 964112233", "mobile_phone": False, "work_email": False},
    {"id": 13, "name": "PEREZ RUIZ, MARIA", "company_id": [7, "TRANSARGI"], "department_id": [5, "Almacén"], "job_id": False,
     "work_phone": False, "mobile_phone": False, "work_email": False},
    {"id": 14, "name": "SANCHEZ GIL, PEDRO", "company_id": [1, "STINSA"], "department_id": False, "job_id": False,
     "work_phone": "655 44 33 22", "mobile_phone": False, "work_email": False},
    {"id": 15, "name": "OTRA PERSONA DISTINTA", "company_id": [1, "STINSA"], "department_id": False, "job_id": False,
     "work_phone": False, "mobile_phone": "699 11 22 33", "work_email": False},
    {"id": 16, "name": "POPESCU ION", "company_id": [1, "STINSA"], "department_id": False, "job_id": False,
     "work_phone": False, "mobile_phone": "+40 721 234 567", "work_email": False},
    {"id": 17, "name": "LOPEZ MARTIN, LAURA", "company_id": [1, "STINSA"], "department_id": [6, "Administración"], "job_id": False,
     "work_phone": "964 11 22 33", "mobile_phone": False, "work_email": "Laura.Lopez@GrupoTrimodos.com"},
]
CONDUCTORES = [
    {"id": 900, "name": "JUAN GARCIA", "parent_id": [50, "STINSA SEVILLA"], "company_id": False, "phone": "612345678", "mobile": False,
     "email": False},
    {"id": 901, "name": "MARIA PEREZ RUIZ", "parent_id": [51, "TRANSARGI"], "company_id": False, "phone": False, "mobile": False,
     "email": False},
]


def persona(id, nombre, telefono=None, con_pin=True, correo=None, **otros):
    return {"id": id, "nombre": nombre, "con_pin": con_pin, "telefono": telefono, "telefono_repetido": False, "correo": correo,
            "chofer": False, "odoo_employee_id": None, "odoo_conductor_id": None, "vinculo_rechazado": None, "confirmado": None,
            "confirmado_por": None, **otros}


PERSONAS = [
    persona("a", "Juan García López", "34612345678", chofer=True),
    persona("b", "Recepción", "34964112233"),
    persona("c", "María Pérez Ruiz"),
    persona("d", "Pedro Sánchez Gil", "34655443322"),
    persona("e", "Luis Enlazado", "34600000000", odoo_employee_id=14, confirmado="2026-11-17T10:00:00Z", confirmado_por="Rosa"),
]


def propuesta(personas=PERSONAS, ocupadas=({"empleado": 14, "conductor": None},)):
    r = org.proponer_vinculos(list(personas), EMPLEADOS, CONDUCTORES, list(ocupadas))
    return r, {p["id"]: p for p in r["pendientes"]}


def test_coincidencia_unica_por_telefono_es_segura_y_lleva_su_conductor():
    _, p = propuesta()
    [emp] = p["a"]["empleados"]
    assert (emp["id"], emp["por"], emp["seguro"], emp["telefono_fin"]) == (10, "telefono", True, "678")
    assert (emp["empresa"], emp["departamento"], emp["puesto"]) == ("STINSA", "Tráfico", "Conductor")
    [con] = p["a"]["conductores"]
    assert (con["id"], con["por"], con["seguro"], con["empresa"]) == (900, "telefono", True, "STINSA SEVILLA")


def test_movil_extranjero_se_compara():
    _, p = propuesta([persona("r", "Ion Popescu", "40721234567")], ocupadas=[])
    [emp] = p["r"]["empleados"]
    assert (emp["id"], emp["por"], emp["seguro"]) == (16, "telefono", True)


def test_telefono_repetido_en_varias_fichas_no_es_seguro():
    _, p = propuesta()
    candidatos = p["b"]["empleados"]
    assert {c["id"] for c in candidatos} == {11, 12, 17}
    assert not any(c["seguro"] for c in candidatos)
    assert all("varias fichas" in c["aviso"] for c in candidatos)


def test_movil_de_otra_persona_con_otro_nombre_no_es_seguro():
    # La persona escribe su móvil sin verificar: si el nombre no se parece, no se marca sola.
    _, p = propuesta([persona("f", "Juan Perez", "34699112233")], ocupadas=[])
    [emp] = p["f"]["empleados"]
    assert (emp["id"], emp["por"], emp["seguro"]) == (15, "telefono", False)
    assert emp["aviso"] == "El nombre no coincide: compruébalo."


def test_movil_que_han_dado_dos_personas_no_es_seguro():
    _, p = propuesta([persona("g", "Juan García López", "34612345678", telefono_repetido=True)], ocupadas=[])
    [emp] = p["g"]["empleados"]
    assert emp["id"] == 10 and not emp["seguro"] and "varias personas de la app" in emp["aviso"]


def test_sin_telefono_propone_por_nombre_y_lo_avisa():
    _, p = propuesta()
    [emp] = p["c"]["empleados"]
    assert (emp["id"], emp["por"], emp["seguro"]) == (13, "nombre", False)
    assert emp["aviso"] == "Por nombre, compruébalo." and emp["telefono_fin"] is None
    assert [c["id"] for c in p["c"]["conductores"]] == [901]


def test_quien_entra_con_microsoft_se_propone_por_su_correo_y_no_por_un_movil():
    laura = persona("h", "Laura López Martín", telefono="34964112233", con_pin=False, correo="laura.lopez@grupotrimodos.com")
    r, p = propuesta([laura], ocupadas=[])
    [emp] = p["h"]["empleados"]
    assert (emp["id"], emp["por"], emp["seguro"], emp["telefono_fin"]) == (17, "correo", True, None)
    assert p["h"]["telefono"] is None and p["h"]["correo"] == "laura.lopez@grupotrimodos.com"
    # Con otro nombre, no se marca sola; sin correo que coincida, por nombre.
    _, p = propuesta([{**laura, "nombre": "Otra Gente"}], ocupadas=[])
    assert not p["h"]["empleados"][0]["seguro"] and p["h"]["empleados"][0]["aviso"] == "El nombre no coincide: compruébalo."
    _, p = propuesta([{**laura, "correo": "laura@gmail.com"}], ocupadas=[])
    assert [(c["id"], c["por"]) for c in p["h"]["empleados"]] == [(17, "nombre")]


def test_correo_en_el_campo_configurado(monkeypatch):
    monkeypatch.setenv("ODOO_CAMPO_CORREO", "x_correo_app")
    empleados = [{**EMPLEADOS[3], "x_correo_app": "maria.chofer@gmail.com"}]
    r = org.proponer_vinculos([persona("i", "María Pérez Ruiz", con_pin=False, correo="Maria.Chofer@gmail.com")], empleados, [], [])
    [emp] = r["pendientes"][0]["empleados"]
    assert (emp["id"], emp["por"], emp["seguro"]) == (13, "correo", True)


def test_ficha_de_otra_persona_no_es_segura():
    _, p = propuesta()
    [emp] = p["d"]["empleados"]
    assert emp["id"] == 14 and emp["ocupada"] and not emp["seguro"]


def test_ficha_descartada_al_deshacer_no_se_marca_sola():
    _, p = propuesta([persona("a", "Juan García López", "34612345678", vinculo_rechazado=10)], ocupadas=[])
    [emp] = p["a"]["empleados"]
    assert emp["descartada"] and not emp["seguro"] and "deshacer" in emp["aviso"]
    assert org.elegible(emp)   # se puede volver a elegir a propósito


def test_enlace_sin_confirmar_se_propone_para_confirmarlo():
    p_c = PERSONAS[2]
    _, p = propuesta([{**p_c, "odoo_employee_id": 11}], ocupadas=[{"empleado": 11, "conductor": None}])
    primero = p["c"]["empleados"][0]
    assert (primero["id"], primero["por"], primero["actual"], primero["ocupada"]) == (11, "actual", True, False)
    _, p = propuesta([{**p_c, "odoo_employee_id": 99}], ocupadas=[])
    assert p["c"]["empleados"][0]["id"] == 99 and not p["c"]["empleados"][0]["disponible"]


def test_enlazadas_con_sus_fichas():
    r, _ = propuesta()
    [e] = r["enlazadas"]
    assert e["id"] == "e" and e["empleado"]["id"] == 14 and e["empleado"]["disponible"] and e["conductor"] is None
    assert e["confirmado_por"] == "Rosa"


def test_no_salen_los_telefonos_ni_los_correos_de_odoo():
    r, _ = propuesta(PERSONAS + [persona("h", "Laura López Martín", con_pin=False, correo="laura.lopez@grupotrimodos.com")])
    texto = json.dumps(r, ensure_ascii=False)
    # Los únicos números enteros que salen son los móviles que guardó cada persona en la app, con formato; de Odoo,
    # como mucho las 3 últimas cifras.
    sin_moviles_app = re.sub(r"\+34 \d{3} \d{3} \d{3}", "", texto)
    assert not re.search(r"\d{4,}", re.sub(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", "", sin_moviles_app)), sin_moviles_app
    numeros = set(re.findall(r"\+34 \d{3} \d{3} \d{3}", texto))
    assert numeros == {"+34 612 345 678", "+34 964 112 233", "+34 655 443 322", "+34 600 000 000"}
    for clave in ("work_phone", "mobile_phone", "private_phone", "work_email", '"phone"', '"mobile"', '"email"'):
        assert clave not in texto
    assert "Laura.Lopez@GrupoTrimodos.com" not in texto   # el correo de Odoo; el de la app sí puede salir


def test_solo_se_leen_telefonos_de_empresa():
    assert org.CAMPOS_TELEFONO_EMPLEADO == ("mobile_phone", "work_phone")
    llamadas = []

    class Falso(OdooClient):
        def __init__(self):
            self.s = type("S", (), {"company_ids": [1, 7]})()

        def _call(self, model, method, args, kwargs=None):
            llamadas.append((model, method, args, kwargs))
            return []
    Falso().empleados_para_vincular()
    [(_, _, _, kwargs)] = llamadas
    assert "private_phone" not in kwargs["fields"] and {"mobile_phone", "work_phone", "work_email"} <= set(kwargs["fields"])


# ---- las rutas -------------------------------------------------------------------------------------------------

YO = "00000000-0000-0000-0000-000000000004"
PERSONA_A = "00000000-0000-0000-0000-00000000000a"


@pytest.fixture
def con_sesion(monkeypatch):
    import servicios.auth as auth
    monkeypatch.setattr(auth, "supabase_configurado", lambda: True)

    def entrar(*permisos):
        monkeypatch.setattr(auth, "usuario_actual", lambda t: Usuario(YO, "Yo", tuple(permisos)))
    return entrar


class Cliente:
    def empleados_para_vincular(self):
        return EMPLEADOS

    def conductores_para_vincular(self):
        return CONDUCTORES


@pytest.fixture
def odoo_falso(monkeypatch):
    @contextmanager
    def conexion(u):
        yield Cliente()
    monkeypatch.setattr(org, "conexion", conexion)


@pytest.fixture
def supabase(monkeypatch):
    """personas_para_vincular y fichas_odoo_enlazadas con la sesión; las llamadas con la clave de servidor, anotadas."""
    estado = {"leidas": [], "llamadas": [], "personas": [{**PERSONAS[0], "id": PERSONA_A}, *PERSONAS[1:]]}

    def leer(token, tabla, params):
        assert token == "x"   # nunca la clave de servidor para leer: Supabase decide a quién ve
        estado["leidas"].append(tabla)
        return estado["personas"] if tabla == "rpc/personas_para_vincular" else [{"empleado": 14, "conductor": None}]

    def llamar(token, funcion, argumentos, general=""):
        estado["llamadas"].append((token, funcion, argumentos))
    monkeypatch.setattr(org.supa, "leer", leer)
    monkeypatch.setattr(org.supa, "llamar", llamar)
    return estado


H = {"Authorization": "Bearer x"}


def test_las_rutas_exigen_sesion(con_sesion):
    c = TestClient(app)
    assert c.get("/api/odoo/vinculos/pendientes").status_code == 401
    assert c.post("/api/odoo/vinculos/confirmar", json={"persona": PERSONA_A, "empleado": 10}).status_code == 401
    assert c.post("/api/odoo/vinculos/deshacer", json={"persona": PERSONA_A}).status_code == 401


@pytest.mark.parametrize("permisos", [(), ("fichaje.fichar", "chofer.usar"), ("equipo.ver", "ausencias.aprobar")])
def test_las_rutas_exigen_personas_vincular(con_sesion, monkeypatch, permisos):
    con_sesion(*permisos)
    monkeypatch.setattr(org.supa, "leer", lambda *a: pytest.fail("Sin permiso no se lee nada"))
    monkeypatch.setattr(org.supa, "llamar", lambda *a, **k: pytest.fail("Sin permiso no se confirma nada"))
    c = TestClient(app)
    assert c.get("/api/odoo/vinculos/pendientes", headers=H).status_code == 403
    assert c.post("/api/odoo/vinculos/confirmar", headers=H, json={"persona": PERSONA_A, "empleado": 10}).status_code == 403
    assert c.post("/api/odoo/vinculos/deshacer", headers=H, json={"persona": PERSONA_A}).status_code == 403


def test_la_ruta_lee_con_la_sesion_de_quien_mira_y_no_da_telefonos(con_sesion, supabase, odoo_falso):
    con_sesion("personas.vincular")
    r = TestClient(app).get("/api/odoo/vinculos/pendientes?modelo=hr.employee", headers=H)
    assert r.status_code == 200
    assert supabase["leidas"] == ["rpc/personas_para_vincular", "rpc/fichas_odoo_enlazadas"]
    assert [p["id"] for p in r.json()["pendientes"]] == [PERSONA_A, "b", "c", "d"]
    assert "699112233" not in re.sub(r"\D", "", r.text)


def test_confirmar_valida_contra_odoo_y_confirma_con_la_clave_de_servidor_en_nombre_de_quien_confirma(con_sesion, supabase, odoo_falso):
    con_sesion("personas.vincular")
    r = TestClient(app).post("/api/odoo/vinculos/confirmar", headers=H, json={"persona": PERSONA_A, "empleado": 10, "conductor": 900})
    assert r.status_code == 200 and r.json() == {"ok": True, "nombre": "Juan García López"}
    [(token, funcion, argumentos)] = supabase["llamadas"]
    assert token is supa.SERVICIO and funcion == "confirmar_vinculo_odoo"
    assert argumentos == {"autor": YO, "persona": PERSONA_A, "empleado": 10, "conductor": 900}


@pytest.mark.parametrize("cuerpo, motivo", [
    ({"persona": PERSONA_A, "empleado": 99999999}, "ficha de empleado ya no se puede elegir"),     # no propuesta
    ({"persona": PERSONA_A, "empleado": 14}, "ficha de empleado ya no se puede elegir"),          # de otra persona
    ({"persona": PERSONA_A, "empleado": 10, "conductor": 77777777}, "contacto conductor ya no se puede elegir"),
    ({"persona": "00000000-0000-0000-0000-0000000000ff", "empleado": 10}, "ya no está pendiente"),  # no la ve
])
def test_confirmar_rechaza_lo_que_odoo_no_propone(con_sesion, supabase, odoo_falso, cuerpo, motivo):
    con_sesion("personas.vincular")
    r = TestClient(app).post("/api/odoo/vinculos/confirmar", headers=H, json=cuerpo)
    assert r.status_code == 409 and motivo in r.json()["error"]
    assert supabase["llamadas"] == []


@pytest.mark.parametrize("cuerpo", [{"persona": "no-es-un-id", "empleado": 10}, {"persona": PERSONA_A, "empleado": 0},
                                    {"persona": PERSONA_A, "empleado": 10, "modelo": "hr.payslip"}])
def test_confirmar_rechaza_datos_raros(con_sesion, supabase, odoo_falso, cuerpo):
    con_sesion("personas.vincular")
    r = TestClient(app).post("/api/odoo/vinculos/confirmar", headers=H, json=cuerpo)
    assert r.status_code in (400, 422) and supabase["llamadas"] == []


def test_deshacer_solo_a_quien_ve_enlazado_y_con_la_clave_de_servidor(con_sesion, supabase, monkeypatch):
    con_sesion("personas.vincular")
    monkeypatch.setattr(org, "conexion", lambda *a: pytest.fail("Deshacer no necesita Odoo"))
    c = TestClient(app)
    r = c.post("/api/odoo/vinculos/deshacer", headers=H, json={"persona": PERSONA_A})   # no está confirmada
    assert r.status_code == 409 and supabase["llamadas"] == []
    supabase["personas"].append(persona("00000000-0000-0000-0000-00000000000e", "Luis Enlazado", odoo_employee_id=14,
                                        confirmado="2026-11-17T10:00:00Z"))
    r = c.post("/api/odoo/vinculos/deshacer", headers=H, json={"persona": "00000000-0000-0000-0000-00000000000e"})
    assert r.status_code == 200
    assert supabase["llamadas"] == [(supa.SERVICIO, "deshacer_vinculo_odoo", {"autor": YO, "persona": "00000000-0000-0000-0000-00000000000e"})]


def test_el_aviso_de_la_base_de_datos_llega_a_la_pantalla(con_sesion, supabase, odoo_falso, monkeypatch):
    con_sesion("personas.vincular")

    def llamar(*a, **k):
        raise AppError("Tiene la jornada abierta y su entrada ya está en otra ficha de Odoo. Confírmalo cuando fiche la salida.", 409)
    monkeypatch.setattr(org.supa, "llamar", llamar)
    r = TestClient(app).post("/api/odoo/vinculos/confirmar", headers=H, json={"persona": PERSONA_A, "empleado": 10})
    assert r.status_code == 409 and "jornada abierta" in r.json()["error"]


def test_sin_personas_no_consulta_odoo(con_sesion, monkeypatch):
    con_sesion("personas.vincular")
    monkeypatch.setattr(org.supa, "leer", lambda *a: [])
    monkeypatch.setattr(org, "conexion", lambda *a: pytest.fail("No debe consultar Odoo"))
    r = TestClient(app).get("/api/odoo/vinculos/pendientes", headers=H)
    assert r.status_code == 200 and r.json()["pendientes"] == []


def test_sin_migracion_lo_dice_claro_y_otro_fallo_no_lo_confunde(con_sesion, monkeypatch):
    con_sesion("personas.vincular")

    def falta(*a):
        raise supa.FaltaEnBase("No se han podido leer los datos.", 503)
    monkeypatch.setattr(org.supa, "leer", falta)
    r = TestClient(app).get("/api/odoo/vinculos/pendientes", headers=H)
    assert r.status_code == 503 and "migración" in r.json()["error"]

    def caida(*a):
        raise AppError("No se han podido leer los datos.", 503)
    monkeypatch.setattr(org.supa, "leer", caida)
    r = TestClient(app).get("/api/odoo/vinculos/pendientes", headers=H)
    assert r.status_code == 503 and "migración" not in r.json()["error"] and "Inténtalo de nuevo" in r.json()["error"]


# ---- supa: distinguir «falta la migración» de otros fallos y pasar los avisos de la base de datos ----------------

@pytest.fixture
def respuesta(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://proyecto.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "clave-publica")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "clave-secreta")
    vistas = []

    def poner(estado, cuerpo):
        def handler(req):
            vistas.append(req)
            return httpx.Response(estado, json=cuerpo)
        monkeypatch.setattr(supa, "_cliente", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    poner.vistas = vistas
    return poner


@pytest.mark.parametrize("estado, codigo, falta", [(404, "PGRST202", True), (400, "42703", True), (401, "PGRST301", False),
                                                  (403, "42501", False), (503, "", False)])
def test_leer_distingue_que_falta_la_migracion(respuesta, estado, codigo, falta):
    respuesta(estado, {"code": codigo, "message": "x"})
    with pytest.raises(AppError) as e:
        supa.leer("tok", "rpc/personas_para_vincular", {})
    assert isinstance(e.value, supa.FaltaEnBase) is falta


def test_llamar_pasa_el_aviso_de_la_base_de_datos_y_usa_la_clave_de_servidor(respuesta):
    respuesta(409, {"code": "55000", "message": "Tiene la jornada abierta"})
    with pytest.raises(AppError) as e:
        supa.llamar(supa.SERVICIO, "confirmar_vinculo_odoo", {"autor": YO})
    assert e.value.message == "Tiene la jornada abierta" and not isinstance(e.value, supa.FaltaEnBase)
    req = respuesta.vistas[-1]
    assert req.method == "POST" and req.url.path == "/rest/v1/rpc/confirmar_vinculo_odoo"
    assert req.headers["apikey"] == "clave-secreta" and "authorization" not in req.headers
    respuesta(400, {"code": "P0001", "message": "detalle interno"})
    with pytest.raises(AppError) as e:
        supa.llamar(supa.SERVICIO, "confirmar_vinculo_odoo", {}, "No se ha podido guardar el enlace.")
    assert e.value.message == "No se ha podido guardar el enlace."


# ---- lecturas de Odoo: solo métodos de lectura y dominios fijos ------------------------------------------------

def test_lecturas_de_odoo_fijas_y_solo_de_lectura():
    llamadas = []

    class Falso(OdooClient):
        def __init__(self):
            self.s = type("S", (), {"company_ids": [1, 7]})()

        def _call(self, model, method, args, kwargs=None):
            llamadas.append((model, method, args))
            if model == "res.company":
                return [{"id": 1, "partner_id": [100, "STINSA"]}, {"id": 7, "partner_id": [107, "TRANSARGI"]}]
            return []
    c = Falso()
    assert c.empleados_para_vincular() == [] and c.conductores_para_vincular() == []
    assert {m for _, m, _ in llamadas} == {"search_read"}
    empleados = next(a for m, _, a in llamadas if m == "hr.employee")[0]
    assert ["active", "=", True] in empleados and ["company_id", "in", [1, 7]] in empleados
    conductores = next(a for m, _, a in llamadas if m == "res.partner")[0]
    assert ["is_driver", "=", True] in conductores and ["parent_id", "child_of", [100, 107]] in conductores
