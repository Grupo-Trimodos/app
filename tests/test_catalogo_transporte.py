"""El catálogo requiere sesión real y permiso global propio, incluso en desarrollo."""
import pytest
from fastapi.testclient import TestClient
from servicios.main import app
from servicios.auth import Usuario, requiere_permiso
from servicios.errors import AppError
from servicios.flota import catalogo_odoo
from servicios.config import get_settings
from servicios.odoo_client import OdooClient


def test_catalogo_rechaza_sesion_simulada():
    with pytest.raises(AppError) as e:
        catalogo_odoo(buscar="", u=Usuario("prueba", "Prueba", (), es_admin=True))
    assert e.value.status == 401


def test_permiso_flota_no_da_acceso_al_catalogo(monkeypatch):
    import servicios.auth as auth
    monkeypatch.setattr(auth, "supabase_configurado", lambda: True)
    monkeypatch.setattr(auth, "usuario_actual", lambda token: Usuario("u", "U", ("flota.ver",)))
    with pytest.raises(AppError) as e:
        requiere_permiso("transporte.ver")(authorization="Bearer prueba")
    assert e.value.status == 403


def test_catalogo_no_admite_peticion_anonima(monkeypatch):
    import servicios.auth as auth
    monkeypatch.setattr(auth, "supabase_configurado", lambda: True)
    assert TestClient(app).get("/api/flota/catalogo-odoo").status_code == 401


def test_catalogo_limita_y_no_expone_campos_personales(monkeypatch):
    c = OdooClient(get_settings())
    llamadas = []
    def leer(modelo, metodo, args, kwargs):
        llamadas.append((modelo, metodo, args, kwargs))
        return [{"id": i, "name": "Conductor", "license_plate": "1234ABC", "email": "privado"} for i in range(101)]
    monkeypatch.setattr(c, "_call", leer)
    r = c.catalogo_transporte("ABC", incluir_externos=True)
    assert r["limitado"] and len(r["vehiculos"]) == len(r["choferes"]) == 100
    assert all("email" not in row for row in r["choferes"])
    assert r["vehiculos"][0]["empresa"] == "Sin asignar"
    for modelo, metodo, args, kwargs in llamadas:
        assert metodo == "search_read"
        assert ["company_id", "in", c.s.company_ids] in args[0]
        assert ["active", "=", True] in args[0]
    assert ["is_driver", "=", True] in llamadas[1][2][0]


def test_flota_propia_no_lee_contactos_externos(monkeypatch):
    c = OdooClient(get_settings())
    llamadas = []
    def leer(modelo, metodo, args, kwargs):
        llamadas.append((modelo, args))
        return [{"id": 1, "license_plate": "1234ABC", "company_owner_id": [1, "Propietaria"], "company_id": False}]
    monkeypatch.setattr(c, "_call", leer)
    r = c.catalogo_transporte()
    assert r["choferes"] == [] and not r["incluye_externos"]
    assert r["vehiculos"][0]["empresa"] == "Propietaria"
    assert len(llamadas) == 1 and llamadas[0][0] == "fleet.vehicle"
    assert ["is_own_vehicle", "=", True] in llamadas[0][1][0]
    assert ["company_owner_id", "in", c.s.company_ids] in llamadas[0][1][0]


def test_externos_requiere_permiso_adicional():
    with pytest.raises(AppError) as e:
        catalogo_odoo(buscar="", externos=True, u=Usuario("u", "U", ("transporte.ver",), token="t"))
    assert e.value.status == 403
