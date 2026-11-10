r"""Comprobación de COMPATIBILIDAD con una versión de Odoo (p. ej. la 18). SOLO LECTURA: no escribe ni genera informes PDF.

Uso (con ENV_FILE apuntando al entorno a probar):
    $env:ENV_FILE=".env.odoo18"; .\.venv\Scripts\python.exe -X utf8 -m scripts.comprobar_compatibilidad
"""
import sys

from servicios.config import get_settings
from servicios.odoo_client import (ATTACHMENT_FIELDS, ATTACHMENT_MODEL, EDITABLE_FIELDS, GOODS_MODEL, PACKAGE_FIELDS, PACKAGE_MODEL,
                             REPORT_NAME, TASK_FIELDS, TASK_MODEL, ATTENDANCE_MODEL, EMPLOYEE_MODEL,
                             LEAVE_MODEL, LEAVE_TYPE_MODEL, OdooClient)


OPCIONALES: set[str] = set()   # campos que pueden faltar sin que la app deje de funcionar (ahora ninguno)

# Campos leídos, filtrados o enviados por el cliente de RRHH; aquí solo se consulta su existencia.
CAMPOS_RRHH = {
    EMPLOYEE_MODEL: ["id", "name", "work_email", "barcode"],
    ATTENDANCE_MODEL: ["id", "employee_id", "check_in", "check_out"],
    LEAVE_MODEL: ["id", "employee_id", "holiday_status_id", "request_date_from", "request_date_to", "name", "state"],
    LEAVE_TYPE_MODEL: ["id", "name"],
}


def main():
    s = get_settings()
    if s.mode != "real":
        sys.exit("Pon ODOO_MODE=real en el archivo de entorno.")
    o = OdooClient(s)
    print(f"Servidor: {s.odoo_url}  base: {s.odoo_db}  usuario: {s.odoo_user}")
    print("Versión de Odoo:", o.server_version())
    fallos = 0

    def check(ok, texto):
        nonlocal fallos
        fallos += not ok
        print(("  OK    " if ok else "  FALLA ") + texto)

    o._login()
    check(True, "las credenciales (contraseña o clave API) sirven para JSON-RPC")
    print("\nCompañías visibles:", [(c["id"], c["name"]) for c in (lambda: (o.s.company_ids.clear(), o.list_companies())[1])()])

    print("\nCampos que usa la app:")
    for model, wanted in ((TASK_MODEL, TASK_FIELDS + ["tasks_ids"][:0]), (PACKAGE_MODEL, PACKAGE_FIELDS), (ATTACHMENT_MODEL, ATTACHMENT_FIELDS)):
        try:
            have = o.describe_fields(model, [""]) if model in (TASK_MODEL, PACKAGE_MODEL) else None
        except Exception as e:  # noqa: BLE001
            check(False, f"{model}: no se puede leer ({e})")
            continue
        if have is None:
            continue
        missing = [f for f in wanted if f not in have]
        opcionales = [f for f in missing if f in OPCIONALES]   # la app tiene alternativa para estos
        graves = [f for f in missing if f not in OPCIONALES]
        check(not graves, f"{model}: {len(wanted) - len(missing)}/{len(wanted)} campos"
              + (f"  FALTAN: {graves}" if graves else "") + (f"  (ausentes pero con alternativa: {opcionales})" if opcionales else ""))
    check(EDITABLE_FIELDS <= set(o.describe_fields(PACKAGE_MODEL, [""])), f"{PACKAGE_MODEL}: existen los 4 campos editables")

    print("\nCampos de empleados, fichajes y ausencias (solo metadatos):")
    for model, wanted in CAMPOS_RRHH.items():
        try:
            have = o._call(model, "fields_get", [wanted], {"attributes": ["type"]})
        except Exception as e:  # noqa: BLE001
            check(False, f"{model}: no se puede leer ({e})")
            continue
        missing = [f for f in wanted if f not in have]
        check(not missing, f"{model}: {len(wanted) - len(missing)}/{len(wanted)} campos"
              + (f"  FALTAN: {missing}" if missing else ""))

    try:
        o.search_goods("a", 1)
        check(True, f"{GOODS_MODEL}: name_search funciona")
    except Exception as e:  # noqa: BLE001
        check(False, f"{GOODS_MODEL}: {e}")

    rep = o.find_report()
    check(bool(rep), f"existe el informe {REPORT_NAME}" + (f" (modelo {rep[0]['model']})" if rep else ""))
    check(o.check_web_login(), "las MISMAS credenciales abren sesión web (necesario para imprimir el PDF)")

    print("\nPermisos:")
    for model, op, expected, real in o.check_permissions():
        print(f"  {'ok   ' if expected == real else 'dif. '} {model:14} {op:7} esperado {'SÍ' if expected else 'NO'}  tiene {'SÍ' if real else 'NO'}")
    print("\nTodo correcto." if not fallos else f"\n{fallos} comprobaciones fallan.")


if __name__ == "__main__":
    main()
