"""Organigrama de Odoo → perfiles y alcance (docs/acceso-y-perfiles.md, «Perfiles por organigrama»).
De Odoo solo se lee; la foto y los perfiles se guardan en Supabase con funciones de la base de datos."""
from dataclasses import replace

import pytest

from servicios import sincronizacion, supa
from servicios.config import get_settings
from servicios.odoo_client import METODOS_LECTURA, OdooClient


class OdooFalso(OdooClient):
    def __init__(self):
        self.s = replace(get_settings(), company_ids=[1, 7])
        self.llamadas = []

    def _call(self, model, method, args, kwargs=None):
        self.llamadas.append((model, method, args, kwargs or {}))
        if model == "hr.employee":
            return [
                {"id": 139, "name": "Directora", "company_id": [1, "STINSA"], "department_id": [65, "GRUPO"],
                 "job_id": [14, "Dirección"], "parent_id": False, "work_location_id": [30, "Castellón"]},
                {"id": 7, "name": " Jefa ", "company_id": [1, "STINSA"], "department_id": [4, "Comercial Levante"],
                 "job_id": [21, "Jefe de Tráfico"], "parent_id": [139, "Directora"], "work_location_id": False},
                {"id": 301, "name": "Administrativa", "company_id": [9, "TRIMODOS"], "department_id": False,
                 "job_id": False, "parent_id": [139, "Directora"], "work_location_id": False},
            ]
        if model == "hr.department":
            return [{"id": 65, "name": "GRUPO", "complete_name": "GRUPO TRIMODOS"},
                    {"id": 4, "name": "Comercial Levante", "complete_name": "GRUPO TRIMODOS / STINSA / Tráfico / Comercial Levante"}]
        raise AssertionError(f"lectura inesperada {model}")


def test_el_organigrama_solo_lee_y_trae_el_departamento_completo():
    o = OdooFalso()
    filas = o.organigrama([1, 7, 9])
    assert all(m in METODOS_LECTURA for _, m, _, _ in o.llamadas)
    dominio = o.llamadas[0][2][0]
    assert ["company_id", "in", [1, 7, 9]] in dominio and ["active", "=", True] in dominio
    campos = set(o.llamadas[0][3]["fields"])
    assert campos == {"name", "company_id", "department_id", "job_id", "parent_id", "work_location_id"}   # nada personal
    jefa = next(f for f in filas if f["empleado_id"] == 7)
    assert jefa == {"empleado_id": 7, "nombre": "Jefa", "empresa_id": 1, "empresa": "STINSA", "departamento_id": 4,
                    "departamento": "GRUPO TRIMODOS / STINSA / Tráfico / Comercial Levante", "puesto_id": 21,
                    "puesto": "Jefe de Tráfico", "gerente_id": 139, "ubicacion_id": None, "ubicacion": None}
    admin = next(f for f in filas if f["empleado_id"] == 301)
    assert admin["puesto"] is None and admin["departamento"] is None and admin["gerente_id"] == 139


def test_empresas_del_organigrama(monkeypatch):
    monkeypatch.delenv("ODOO_EMPRESAS_ORGANIGRAMA", raising=False)
    monkeypatch.setenv("ODOO_COMPANY_IDS", "1,7")
    assert get_settings().organigrama_company_ids == [1, 7]
    monkeypatch.setenv("ODOO_EMPRESAS_ORGANIGRAMA", "1,7,9")
    assert get_settings().organigrama_company_ids == [1, 7, 9]


def test_paso_organigrama_guarda_la_foto_y_aplica(monkeypatch):
    llamadas = []
    monkeypatch.setattr(sincronizacion.rrhh, "odoo_real", lambda: True)
    monkeypatch.setattr(sincronizacion, "_odoo", lambda: OdooFalso())

    def llamar(token, funcion, argumentos, general=""):
        assert token is supa.SERVICIO
        llamadas.append((funcion, argumentos))
        return {"guardar_foto_organigrama": {"foto": 3, "nueva": True, "fichas": 3},
                "aplicar_perfiles_organigrama": {"estado": "aplicado", "puestos": 2, "quitados": 1}}[funcion]
    monkeypatch.setattr(sincronizacion.supa, "llamar", llamar)
    r = sincronizacion._paso_organigrama(10 ** 9)
    assert [f for f, _ in llamadas] == ["guardar_foto_organigrama", "aplicar_perfiles_organigrama"]
    assert len(llamadas[0][1]["fichas"]) == 3
    assert r == {"fichas": 3, "foto_nueva": 1, "perfiles_puestos": 2, "perfiles_quitados": 1}


def test_paso_organigrama_apagado_solo_guarda_la_foto(monkeypatch):
    monkeypatch.setattr(sincronizacion.rrhh, "odoo_real", lambda: True)
    monkeypatch.setattr(sincronizacion, "_odoo", lambda: OdooFalso())
    monkeypatch.setattr(sincronizacion.supa, "llamar", lambda t, f, a, g="": {"foto": 3, "nueva": False, "fichas": 3}
                        if f == "guardar_foto_organigrama" else {"estado": "apagado"})
    r = sincronizacion._paso_organigrama(10 ** 9)
    assert r["fichas"] == 3 and r["foto_nueva"] == 0 and "apagados" in r["aviso"]


def test_paso_organigrama_con_odoo_simulado_no_guarda_nada(monkeypatch):
    monkeypatch.setattr(sincronizacion.rrhh, "odoo_real", lambda: False)
    monkeypatch.setattr(sincronizacion.supa, "llamar", lambda *a, **k: pytest.fail("no debe guardar"))
    assert "simulado" in sincronizacion._paso_organigrama(10 ** 9)["aviso"]


def test_paso_organigrama_sin_fichas_no_cambia_nada(monkeypatch):
    class Vacio(OdooFalso):
        def organigrama(self, empresas):
            return []
    monkeypatch.setattr(sincronizacion.rrhh, "odoo_real", lambda: True)
    monkeypatch.setattr(sincronizacion, "_odoo", lambda: Vacio())
    monkeypatch.setattr(sincronizacion.supa, "llamar", lambda *a, **k: pytest.fail("no debe guardar"))
    assert "ninguna ficha" in sincronizacion._paso_organigrama(10 ** 9)["aviso"]


def test_el_simulado_tiene_organigrama():
    from servicios.mock_odoo import MockOdoo
    filas = MockOdoo().organigrama([1, 7])
    assert {f["empleado_id"] for f in filas} == {1, 2, 3, 4, 5, 6}
    assert MockOdoo().organigrama([1]) and all(f["empresa_id"] == 1 for f in MockOdoo().organigrama([1]))
