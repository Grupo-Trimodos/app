"""Diagnóstico de RRHH sin conexiones ni credenciales reales."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from scripts import comprobar_compatibilidad as script
from servicios.odoo_client import OdooClient, PACKAGE_FIELDS, TASK_FIELDS


CAMPOS = {
    "hr.employee": {"id", "name", "work_email", "barcode"},
    "hr.attendance": {"id", "employee_id", "check_in", "check_out"},
    "hr.leave": {"id", "employee_id", "holiday_status_id", "request_date_from", "request_date_to", "name", "state"},
    "hr.leave.type": {"id", "name"},
}


@pytest.fixture
def cliente(monkeypatch):
    s = SimpleNamespace(mode="real", odoo_url="https://odoo.invalid", odoo_db="pruebas", odoo_user="prueba")
    o = Mock(spec=OdooClient)
    o.s = SimpleNamespace(company_ids=[1])
    o.list_companies.return_value = []
    o.describe_fields.return_value = dict.fromkeys(TASK_FIELDS + PACKAGE_FIELDS, {})
    o.find_report.return_value = [{"model": "project.task"}]
    o.check_permissions.return_value = []
    o._call.side_effect = lambda model, method, *args, **kwargs: dict.fromkeys(CAMPOS[model], {})
    monkeypatch.setattr(script, "get_settings", lambda: s)
    monkeypatch.setattr(script, "OdooClient", lambda settings: o)
    monkeypatch.delenv("ODOO_CAMPO_CORREO", raising=False)
    return o


def test_comprueba_rrhh_solo_con_metadatos(cliente, capsys):
    script.main()
    salida = capsys.readouterr().out
    assert "Todo correcto." in salida
    for modelo in CAMPOS:
        assert modelo in salida
    assert {c.args[0] for c in cliente._call.call_args_list} == set(CAMPOS)
    assert all(c.args[1] == "fields_get" for c in cliente._call.call_args_list)
    cliente.abrir_asistencia.assert_not_called()
    cliente.cerrar_asistencia.assert_not_called()
    cliente.crear_ausencia.assert_not_called()


@pytest.mark.parametrize("modelo,campo", [(m, c) for m, campos in CAMPOS.items() for c in sorted(campos)])
def test_detecta_cada_campo_ausente(cliente, capsys, modelo, campo):
    cliente._call.side_effect = lambda m, *a, **k: dict.fromkeys(CAMPOS[m] - ({campo} if m == modelo else set()), {})
    script.main()
    salida = capsys.readouterr().out
    assert f"FALTAN: ['{campo}']" in salida
    assert "1 comprobaciones fallan." in salida


@pytest.mark.parametrize("modelo", CAMPOS)
def test_error_de_lectura_no_impide_comprobar_el_resto(cliente, capsys, modelo):
    def leer(m, *args, **kwargs):
        if m == modelo:
            raise PermissionError("Lectura denegada")
        return dict.fromkeys(CAMPOS[m], {})
    cliente._call.side_effect = leer
    script.main()
    salida = capsys.readouterr().out
    assert f"{modelo}: no se puede leer" in salida
    assert "1 comprobaciones fallan." in salida
    assert {c.args[0] for c in cliente._call.call_args_list} == set(CAMPOS)
