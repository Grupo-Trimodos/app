from contextlib import contextmanager
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from servicios.main import app
from servicios.auth import Usuario
from servicios.config import get_settings
from servicios.errors import AppError
from servicios.odoo_client import OdooClient
from servicios import organizacion as org


def estructura():
    return {
        "ubicaciones": [{"id": 1, "name": "Valencia", "company_id": [1, "A"]},
                        {"id": 2, "name": "VALENCIA", "company_id": [7, "B"]}],
        "departamentos": [{"id": 30, "name": "Almacén Burriana", "company_id": [1, "A"]}],
    }


def test_mismo_nombre_no_vincula_ni_fusiona_empresas():
    r = org.relacionar_centros([{"id": 5, "nombre": "Oficina Valencia"}], estructura())[0]
    assert r["estado"] == "Varias coincidencias · confirmar"
    assert len(r["candidatos"]) == 2


def test_montaje_es_solo_propuesta_con_origen_departamento():
    r = org.relacionar_centros([{"id": 5, "nombre": "Montaje Burriana"}], estructura())[0]
    assert r["modelo"] == "hr.department" and r["candidatos"][0]["id"] == 30
    assert r["estado"] == "Propuesta por nombre · confirmar"


def test_identificador_invalido_no_se_sustituye_por_nombre():
    r = org.relacionar_centros([{"id": 5, "nombre": "Valencia", "odoo_ubicacion_id": 999}], estructura())[0]
    assert not r["candidatos"] and r["estado"] == "Vínculo no disponible en Odoo"


def test_identificador_exacto_no_depende_del_nombre():
    r = org.relacionar_centros([{"id": 5, "nombre": "Otro nombre", "odoo_ubicacion_id": 2}], estructura())[0]
    assert r["estado"] == "Vinculado por identificador" and r["candidatos"][0]["id"] == 2


@pytest.mark.parametrize("ruta", ["/api/odoo/organizacion", "/api/odoo/mi-organizacion"])
def test_organizacion_exige_sesion_real(ruta, monkeypatch):
    import servicios.auth as auth
    monkeypatch.setattr(auth, "supabase_configurado", lambda: True)
    assert TestClient(app).get(ruta).status_code == 401


def test_persona_sin_permiso_no_ve_estructura_global(monkeypatch):
    import servicios.auth as auth
    monkeypatch.setattr(auth, "supabase_configurado", lambda: True)
    monkeypatch.setattr(auth, "usuario_actual", lambda t: Usuario("u", "U", ("fichaje.fichar",)))
    assert TestClient(app).get("/api/odoo/organizacion", headers={"Authorization": "Bearer x"}).status_code == 403


def test_ficha_solo_del_empleado_vinculado_a_la_sesion(monkeypatch):
    import servicios.auth as auth
    monkeypatch.setattr(auth, "supabase_configurado", lambda: True)
    monkeypatch.setattr(auth, "usuario_actual", lambda t: Usuario("yo", "Yo", ()))
    def leer(token, tabla, params):
        assert token == "x" and tabla == "usuarios" and params["id"] == "eq.yo"
        return [{"odoo_employee_id": 123}]
    monkeypatch.setattr(org.supa, "leer", leer)
    class Cliente:
        def organizacion_personal(self, empleado):
            assert empleado == 123
            return {"empresa": "A"}
    @contextmanager
    def conexion(u):
        yield Cliente()
    monkeypatch.setattr(org, "conexion", conexion)
    r = TestClient(app).get("/api/odoo/mi-organizacion?empleado_id=999", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200 and r.json()["ficha"] == {"empresa": "A"}


def test_sin_vinculo_no_busca_personas_por_nombre(monkeypatch):
    monkeypatch.setattr(org.supa, "leer", lambda *a: [{"odoo_employee_id": None}])
    monkeypatch.setattr(org, "conexion", lambda *a: pytest.fail("No debe consultar Odoo sin vínculo"))
    assert org.mi_organizacion(Usuario("u", "U", (), token="x"))["ficha"] is None


def test_ficha_no_expone_datos_laborales_sensibles(monkeypatch):
    c = OdooClient(replace(get_settings(), company_ids=[7]))
    def llamada(modelo, metodo, args, kwargs):
        assert ["company_id", "in", [7]] in args[0]
        assert ["id", "=", 123] in args[0]
        assert set(kwargs["fields"]) == {"company_id", "department_id", "work_location_id", "job_id", "parent_id"}
        return [{"id": 123, "company_id": [7, "A"], "salary": 999}]
    monkeypatch.setattr(c, "_call", llamada)
    assert c.organizacion_personal(123) == {"empresa": "A", "area": None, "ubicacion": None, "puesto": None, "responsable": None}


def test_recuentos_filtran_empresas_y_no_devuelven_dominios(monkeypatch):
    c = OdooClient(replace(get_settings(), company_ids=[7]))
    def llamada(modelo, metodo, args, kwargs=None):
        assert ["company_id", "in", [7]] in args[0]
        if metodo == "read_group":
            campo = args[1][0]
            return [{campo: [3, "Grupo"], "__count": 4, "__domain": ["dato interno"]}]
        return 1 if metodo == "search_count" else []
    monkeypatch.setattr(c, "_call", llamada)
    r = c.estructura_organizacion()
    assert r["plantilla"] == 4 and r["sin_responsable"] == 1
    assert "__domain" not in str(r)
