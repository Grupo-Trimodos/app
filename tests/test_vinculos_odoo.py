"""Enlace de cada persona de la app con Odoo por su móvil: normalización, propuestas, permiso y que no salgan los
teléfonos de Odoo. Sin conexiones reales: Supabase y Odoo simulados."""
from contextlib import contextmanager
import json
import re

import pytest
from fastapi.testclient import TestClient

from servicios.auth import Usuario
from servicios.main import app
from servicios.odoo_client import OdooClient
from servicios import organizacion as org


@pytest.mark.parametrize("texto, esperado", [
    ("612 34 56 78", "34612345678"), ("+34 612-345-678", "34612345678"), ("0034 (612) 345.678", "34612345678"),
    ("34612345678", "34612345678"), ("964 12 34 56", "34964123456"), ("+44 7700 900123", "447700900123"),
    ("612 345 678", "34612345678"),
    ("6123456789", None), ("12345", None), ("+34 512 345 678", None), ("abc", None), ("", None), (None, None), ("+34 6123", None),
])
def test_normalizar_telefono_igual_que_en_supabase(texto, esperado):
    # Mismos casos que scripts/prueba_vinculo_db.py prueba contra privado.normalizar_telefono.
    assert org.normalizar_telefono(texto) == esperado


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
     "work_phone": False, "mobile_phone": "+34 612 34 56 78", "private_phone": False},
    {"id": 11, "name": "Centralita Uno", "company_id": [1, "STINSA"], "department_id": False, "job_id": False,
     "work_phone": "964 11 22 33", "mobile_phone": False, "private_phone": False},
    {"id": 12, "name": "Centralita Dos", "company_id": [7, "TRANSARGI"], "department_id": False, "job_id": False,
     "work_phone": "+34 964112233", "mobile_phone": False, "private_phone": False},
    {"id": 13, "name": "PEREZ RUIZ, MARIA", "company_id": [7, "TRANSARGI"], "department_id": [5, "Almacén"], "job_id": False,
     "work_phone": False, "mobile_phone": False, "private_phone": "699 88 77 66"},
    {"id": 14, "name": "SANCHEZ GIL, PEDRO", "company_id": [1, "STINSA"], "department_id": False, "job_id": False,
     "work_phone": "655 44 33 22", "mobile_phone": False, "private_phone": False},
]
CONDUCTORES = [
    {"id": 900, "name": "JUAN GARCIA", "parent_id": [50, "STINSA SEVILLA"], "company_id": False, "phone": "612345678", "mobile": False},
    {"id": 901, "name": "MARIA PEREZ RUIZ", "parent_id": [51, "TRANSARGI"], "company_id": False, "phone": False, "mobile": False},
]
PERSONAS = [
    {"id": "a", "nombre": "Juan García López", "telefono": "34612345678", "chofer": True, "odoo_employee_id": None,
     "odoo_conductor_id": None, "confirmado": None, "confirmado_por": None},
    {"id": "b", "nombre": "Recepción", "telefono": "34964112233", "chofer": False, "odoo_employee_id": None,
     "odoo_conductor_id": None, "confirmado": None, "confirmado_por": None},
    {"id": "c", "nombre": "María Pérez Ruiz", "telefono": None, "chofer": False, "odoo_employee_id": None,
     "odoo_conductor_id": None, "confirmado": None, "confirmado_por": None},
    {"id": "d", "nombre": "Pedro Sánchez Gil", "telefono": "34655443322", "chofer": False, "odoo_employee_id": None,
     "odoo_conductor_id": None, "confirmado": None, "confirmado_por": None},
    {"id": "e", "nombre": "Luis Enlazado", "telefono": "34600000000", "chofer": False, "odoo_employee_id": 14,
     "odoo_conductor_id": None, "confirmado": "2026-11-17T10:00:00Z", "confirmado_por": "Rosa"},
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


def test_telefono_repetido_en_varias_fichas_no_es_seguro():
    _, p = propuesta()
    candidatos = p["b"]["empleados"]
    assert {c["id"] for c in candidatos} == {11, 12}
    assert not any(c["seguro"] for c in candidatos)
    assert all("varias fichas" in c["aviso"] for c in candidatos)


def test_sin_telefono_propone_por_nombre_y_lo_avisa():
    _, p = propuesta()
    [emp] = p["c"]["empleados"]
    assert (emp["id"], emp["por"], emp["seguro"]) == (13, "nombre", False)
    assert emp["aviso"] == "Por nombre, compruébalo." and emp["telefono_fin"] is None
    assert [c["id"] for c in p["c"]["conductores"]] == [901]


def test_ficha_de_otra_persona_no_es_segura():
    _, p = propuesta()
    [emp] = p["d"]["empleados"]
    assert emp["id"] == 14 and emp["ocupada"] and not emp["seguro"]


def test_enlace_sin_confirmar_se_propone_para_confirmarlo():
    persona = {**PERSONAS[2], "odoo_employee_id": 11}
    _, p = propuesta([persona], ocupadas=[{"empleado": 11, "conductor": None}])
    primero = p["c"]["empleados"][0]
    assert (primero["id"], primero["por"], primero["actual"], primero["ocupada"]) == (11, "actual", True, False)
    archivada = {**PERSONAS[2], "odoo_employee_id": 99}
    _, p = propuesta([archivada], ocupadas=[])
    assert p["c"]["empleados"][0]["id"] == 99 and not p["c"]["empleados"][0]["disponible"]


def test_enlazadas_con_sus_fichas():
    r, _ = propuesta()
    [e] = r["enlazadas"]
    assert e["id"] == "e" and e["empleado"]["id"] == 14 and e["empleado"]["disponible"] and e["conductor"] is None
    assert e["confirmado_por"] == "Rosa"


def test_no_salen_los_telefonos_de_odoo():
    r, _ = propuesta()
    texto = json.dumps(r, ensure_ascii=False)
    # Los únicos números enteros que salen son los móviles que guardó cada persona en la app, con formato; de Odoo,
    # como mucho las 3 últimas cifras.
    sin_moviles_app = re.sub(r"\+34 \d{3} \d{3} \d{3}", "", texto)
    assert not re.search(r"\d{4,}", re.sub(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", "", sin_moviles_app)), sin_moviles_app
    numeros = set(re.findall(r"\+34 \d{3} \d{3} \d{3}", texto))
    assert numeros == {"+34 612 345 678", "+34 964 112 233", "+34 655 443 322", "+34 600 000 000"}
    for clave in ("work_phone", "mobile_phone", "private_phone", '"phone"', '"mobile"'):
        assert clave not in texto
    assert "699887766" not in re.sub(r"\D", "", texto)   # el privado de María, que no tiene móvil en la app


# ---- la ruta ---------------------------------------------------------------------------------------------------

@pytest.fixture
def con_sesion(monkeypatch):
    import servicios.auth as auth
    monkeypatch.setattr(auth, "supabase_configurado", lambda: True)

    def entrar(*permisos):
        monkeypatch.setattr(auth, "usuario_actual", lambda t: Usuario("yo", "Yo", tuple(permisos)))
    return entrar


def test_la_ruta_exige_sesion(con_sesion):
    assert TestClient(app).get("/api/odoo/vinculos/pendientes").status_code == 401


@pytest.mark.parametrize("permisos", [(), ("fichaje.fichar", "chofer.usar"), ("equipo.ver", "ausencias.aprobar")])
def test_la_ruta_exige_personas_vincular(con_sesion, monkeypatch, permisos):
    con_sesion(*permisos)
    monkeypatch.setattr(org.supa, "leer", lambda *a: pytest.fail("Sin permiso no se lee nada"))
    r = TestClient(app).get("/api/odoo/vinculos/pendientes", headers={"Authorization": "Bearer x"})
    assert r.status_code == 403


def test_la_ruta_lee_con_la_sesion_de_quien_mira_y_no_da_telefonos(con_sesion, monkeypatch):
    con_sesion("personas.vincular")
    leidas = []

    def leer(token, tabla, params):
        assert token == "x"   # nunca la clave de servidor: Supabase decide a quién ve
        leidas.append(tabla)
        return PERSONAS if tabla == "rpc/personas_para_vincular" else [{"empleado": 14, "conductor": None}]
    monkeypatch.setattr(org.supa, "leer", leer)

    class Cliente:
        def empleados_para_vincular(self):
            return EMPLEADOS

        def conductores_para_vincular(self):
            return CONDUCTORES

    @contextmanager
    def conexion(u):
        yield Cliente()
    monkeypatch.setattr(org, "conexion", conexion)
    r = TestClient(app).get("/api/odoo/vinculos/pendientes?modelo=hr.employee", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200
    assert leidas == ["rpc/personas_para_vincular", "rpc/fichas_odoo_enlazadas"]
    datos = r.json()
    assert [p["id"] for p in datos["pendientes"]] == ["a", "b", "c", "d"]
    assert "699887766" not in re.sub(r"\D", "", r.text)


def test_sin_personas_no_consulta_odoo(con_sesion, monkeypatch):
    con_sesion("personas.vincular")
    monkeypatch.setattr(org.supa, "leer", lambda *a: [])
    monkeypatch.setattr(org, "conexion", lambda *a: pytest.fail("No debe consultar Odoo"))
    r = TestClient(app).get("/api/odoo/vinculos/pendientes", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200 and r.json()["pendientes"] == []


def test_sin_migracion_lo_dice_claro(con_sesion, monkeypatch):
    from servicios.errors import AppError
    con_sesion("personas.vincular")

    def leer(*a):
        raise AppError("No se han podido leer los datos.", 503)
    monkeypatch.setattr(org.supa, "leer", leer)
    r = TestClient(app).get("/api/odoo/vinculos/pendientes", headers={"Authorization": "Bearer x"})
    assert r.status_code == 503 and "migración" in r.json()["error"]


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
