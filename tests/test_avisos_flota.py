"""Avisos de asignación de flota: camiones propios sin chófer y chóferes del grupo sin camión (solo lectura de Odoo)."""
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from servicios.auth import Usuario
from servicios.config import get_settings
from servicios.errors import AppError
from servicios.flota import avisos_asignacion
from servicios.main import app
from servicios.odoo_client import METODOS_LECTURA, OdooClient

EMPRESAS = [{"id": 1, "name": "STINSA", "partner_id": [11, "STINSA"]},
            {"id": 7, "name": "Transargi", "partner_id": [77, "Transargi"]}]
TIPOS = {"vehicle_type": {"selection": [["truck", "Camión"], ["tractor", "Cabeza tractora"], ["trailer", "Semirremolque"]]}}
VEHICULOS = [
    {"id": 1, "license_plate": "1111AAA", "model_id": [5, "Volvo FH"], "company_owner_id": [7, "Transargi"],
     "driver_id": False, "vehicle_type": "tractor"},                                     # camión sin chófer
    {"id": 2, "license_plate": "R-2222", "model_id": [6, "Lecitrailer"], "company_owner_id": [7, "Transargi"],
     "driver_id": False, "vehicle_type": "trailer"},                                     # remolque sin chófer: aparte
    {"id": 3, "license_plate": "3333CCC", "model_id": [5, "Volvo FH"], "company_owner_id": [1, "STINSA"],
     "driver_id": [101, "Chófer con dos"], "vehicle_type": "tractor"},
    {"id": 4, "license_plate": "R-4444", "model_id": [6, "Lecitrailer"], "company_owner_id": [1, "STINSA"],
     "driver_id": [101, "Chófer con dos"], "vehicle_type": "trailer"},                   # mismo conductor: dos vehículos
    {"id": 5, "license_plate": "5555EEE", "model_id": [7, "Scania R"], "company_owner_id": [1, "STINSA"],
     "driver_id": [102, "Chófer con ficha"], "vehicle_type": "truck"},
    {"id": 6, "license_plate": "6666FFF", "model_id": [7, "Scania R"], "company_owner_id": [1, "STINSA"],
     "driver_id": [103, "Chófer archivado"], "vehicle_type": "tractor"},                # conductor dado de baja
    {"id": 7, "license_plate": "7777GGG", "model_id": [7, "Scania R"], "company_owner_id": [1, "STINSA"],
     "driver_id": [301, "Chófer de centro con camión"], "vehicle_type": "tractor"},
]
ARCHIVADOS = {103}
# El dominio de Odoo ya deja fuera los contactos de subcontratas: el simulado solo devuelve lo que Odoo devolvería
# (por eso la comprobación de la cifra real se hace contra Odoo; ver docs/odoo.md).
# Contactos de centro: 12888 «STINSA SEVILLA» cuelga de STINSA (11); 12999 «Nave» cuelga del centro (dos niveles).
PADRES = {12888: [11, "STINSA"], 12999: [12888, "STINSA SEVILLA"]}
CHOFERES = [
    {"id": 101, "name": "Chófer con dos", "parent_id": [11, "STINSA"], "company_id": False},
    {"id": 201, "name": "Chófer sin camión", "parent_id": [77, "Transargi"], "company_id": False},
    {"id": 202, "name": "Chófer con ficha y sin camión", "parent_id": False, "company_id": False, "employee_ids": [56]},
    {"id": 300, "name": "Chófer de centro sin camión", "parent_id": [12888, "STINSA SEVILLA"], "company_id": False},
    {"id": 301, "name": "Chófer de centro con camión", "parent_id": [12888, "STINSA SEVILLA"], "company_id": False},
    {"id": 302, "name": "Chófer de nave", "parent_id": [12999, "Nave"], "company_id": False},
]


def cliente(monkeypatch):
    c = OdooClient(replace(get_settings(), company_ids=[1, 7]))
    llamadas = []

    def leer(modelo, metodo, args, kwargs=None):
        llamadas.append((modelo, metodo, args, kwargs))
        assert metodo in METODOS_LECTURA
        if modelo == "res.company":
            return EMPRESAS
        if modelo == "fleet.vehicle" and metodo == "fields_get":
            return TIPOS
        if modelo == "fleet.vehicle":
            return VEHICULOS
        if modelo == "res.partner" and metodo == "search_read":
            return CHOFERES
        if modelo == "hr.employee" and metodo == "read":     # empresa de la ficha, para quien no cuelga de una empresa
            return [{"id": i, "company_id": [1, "STINSA"]} for i in args[0]]
        if modelo == "res.partner" and metodo == "read" and kwargs["fields"] == ["parent_id"]:
            return [{"id": i, "parent_id": PADRES.get(i, False)} for i in args[0]]
        if modelo == "res.partner" and metodo == "read":
            return [{"id": i, "active": i not in ARCHIVADOS, "employee_ids": [55] if i == 102 else []} for i in args[0]]
        raise AssertionError((modelo, metodo))

    monkeypatch.setattr(c, "_call", leer)
    return c, llamadas


def test_camion_sin_chofer_y_remolque_aparte(monkeypatch):
    c, _ = cliente(monkeypatch)
    r = c.avisos_asignacion_flota()
    assert r["camiones"] == 7
    assert [(v["matricula"], v["tipo"], v["empresa"], v["modelo"]) for v in r["camiones_sin_chofer"]][0] == (
        "1111AAA", "Cabeza tractora", "Transargi", "Volvo FH")
    assert [(v["matricula"], v["tipo"]) for v in r["remolques_sin_chofer"]] == [("R-2222", "Semirremolque")]


def test_chofer_del_grupo_sin_camion(monkeypatch):
    c, _ = cliente(monkeypatch)
    r = c.avisos_asignacion_flota()
    assert [(x["nombre"], x["empresa"]) for x in r["choferes_sin_camion"]] == [
        ("Chófer sin camión", "Transargi"), ("Chófer con ficha y sin camión", "STINSA"),
        ("Chófer de centro sin camión", "STINSA"), ("Chófer de nave", "STINSA")]


def test_chofer_de_centro_cuenta_como_del_grupo(monkeypatch):
    """En producción casi todos los chóferes de STINSA cuelgan de un centro (STINSA SEVILLA…), no de la empresa."""
    c, llamadas = cliente(monkeypatch)
    r = c.avisos_asignacion_flota()
    nombres = [x["nombre"] for x in r["choferes_sin_camion"]]
    assert "Chófer de centro sin camión" in nombres and "Chófer de nave" in nombres
    assert "Chófer de centro con camión" not in nombres   # conduce un camión propio
    lecturas_padre = [a[0] for m, met, a, k in llamadas if m == "res.partner" and met == "read" and k["fields"] == ["parent_id"]]
    assert lecturas_padre == [[12888, 12999]]   # una sola lectura de los padres: el centro ya lleva a la empresa


def test_camion_con_chofer_archivado_cuenta_como_sin_chofer(monkeypatch):
    c, _ = cliente(monkeypatch)
    r = c.avisos_asignacion_flota()
    baja = [v for v in r["camiones_sin_chofer"] if v["matricula"] == "6666FFF"]
    assert baja and baja[0]["chofer_baja"] == "Chófer archivado"
    assert not any(x["id"] == 103 for x in r["choferes_varios_camiones"])
    assert "chofer_baja" not in r["camiones_sin_chofer"][0]
    assert r["conductores"] == 3   # 101, 102 y 301; el archivado no cuenta


def test_contacto_de_subcontrata_no_cuenta(monkeypatch):
    c, llamadas = cliente(monkeypatch)
    c.avisos_asignacion_flota()
    dominio = next(a[0] for m, met, a, k in llamadas if m == "res.partner" and met == "search_read")
    assert ["is_driver", "=", True] in dominio and ["active", "=", True] in dominio
    assert ["parent_id", "child_of", [11, 77]] in dominio      # cuelgan de las empresas configuradas (o de sus centros)
    assert ["employee_ids.company_id", "in", [1, 7]] in dominio  # o con ficha de empleado en ellas
    assert ["id", "not in", [11, 77]] in dominio                 # el contacto de la propia empresa no es un chófer
    assert dominio.index("|") == dominio.index(["parent_id", "child_of", [11, 77]]) - 1
    assert len(dominio) == 6   # no hay otra rama del «o» que deje pasar contactos de subcontratas


def test_solo_flota_propia_de_las_empresas_configuradas(monkeypatch):
    c, llamadas = cliente(monkeypatch)
    c.avisos_asignacion_flota()
    dominio = next(a[0] for m, met, a, k in llamadas if m == "fleet.vehicle" and met == "search_read")
    assert ["is_own_vehicle", "=", True] in dominio
    assert ["company_owner_id", "in", [1, 7]] in dominio
    assert ["active", "=", True] in dominio


def test_conductor_con_dos_vehiculos_y_sin_ficha(monkeypatch):
    c, _ = cliente(monkeypatch)
    r = c.avisos_asignacion_flota()
    assert r["choferes_varios_camiones"] == [{"id": 101, "nombre": "Chófer con dos", "matriculas": ["3333CCC", "R-4444"]}]
    assert r["conductores"] == 3 and r["conductores_sin_ficha"] == 2
    assert all(x["id"] not in (101, 102, 301) for x in r["choferes_sin_camion"])


def test_avisos_rechazan_sesion_simulada():
    with pytest.raises(AppError) as e:
        avisos_asignacion(u=Usuario("prueba", "Prueba", (), es_admin=True))
    assert e.value.status == 401


def test_avisos_sin_permiso_403(monkeypatch):
    import servicios.auth as auth
    monkeypatch.setattr(auth, "supabase_configurado", lambda: True)
    monkeypatch.setattr(auth, "usuario_actual", lambda token: Usuario("u", "U", ("flota.ver",), token=token))
    r = TestClient(app).get("/api/flota/avisos-asignacion", headers={"Authorization": "Bearer prueba"})
    assert r.status_code == 403


def test_avisos_no_admiten_peticion_anonima(monkeypatch):
    import servicios.auth as auth
    monkeypatch.setattr(auth, "supabase_configurado", lambda: True)
    assert TestClient(app).get("/api/flota/avisos-asignacion").status_code == 401
