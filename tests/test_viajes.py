"""«Mis viajes»: qué órdenes de Odoo le llegan a cada chófer, que el conductor sale siempre de su enlace confirmado (nunca de
fuera), los permisos de las rutas y el orden de los pasos. Sin conexiones reales: Supabase y Odoo simulados."""
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import re

import pytest
from fastapi.testclient import TestClient

from servicios import viajes
from servicios.auth import Usuario
from servicios.main import app
from servicios.odoo_client import CAMPOS_VIAJE, OdooClient, dominio_viajes

RAIZ = Path(__file__).resolve().parent.parent
HOY = date(2026, 11, 17)


# ---- dominio de lectura ---------------------------------------------------------------------------------------

def _valor(registro: dict, campo: str):
    actual = registro
    for parte in campo.split("."):
        actual = actual.get(parte) if isinstance(actual, dict) else None
    return actual


def _hoja(registro: dict, hoja: list) -> bool:
    campo, op, v = hoja
    x = _valor(registro, campo)
    if op == "=":
        return (x in (None, False) and v is False) or x == v
    if op == "!=":
        return not ((x in (None, False) and v is False) or x == v)
    if op == "in":
        return x in v
    if op == "not in":
        return x not in v
    if x in (None, False):
        return False
    return {">=": x >= v, "<": x < v, ">": x > v}[op]


def cumple(registro: dict, dominio: list) -> bool:
    """Evalúa un dominio de Odoo (notación prefija, «&» implícito entre términos) sobre un registro de prueba."""
    pila = []
    for t in reversed(dominio):
        if t == "|":
            a, b = pila.pop(), pila.pop()
            pila.append(a or b)
        elif t == "&":
            a, b = pila.pop(), pila.pop()
            pila.append(a and b)
        elif t == "!":
            pila.append(not pila.pop())
        else:
            pila.append(_hoja(registro, t))
    return all(pila)


def orden(**cambios) -> dict:
    base = {"id": 1, "is_transport_order": True, "driver_id": 900, "company_id": 1, "state": "01_in_progress",
            "stage_id": {"fold": False}, "tms_transport_order_creation_date": "2026-11-16 08:00:00",
            "planned_date_start": "2026-11-18 06:00:00"}
    return {**base, **cambios}


@pytest.mark.parametrize("registro, entra", [
    (orden(), True),                                                                   # emitida, abierta, en fechas
    (orden(tms_transport_order_creation_date=False, state="03_approved"), True),      # aprobada sin emitir
    (orden(tms_transport_order_creation_date=False), False),                          # ni emitida ni aprobada
    (orden(state="1_done"), False), (orden(state="1_canceled"), False),               # hecha o cancelada
    (orden(stage_id={"fold": True}), False),                                          # etapa plegada (Realizado, Facturable…)
    (orden(is_transport_order=False), False),
    (orden(driver_id=901), False),                                                    # de otro conductor
    (orden(company_id=99), False),                                                    # de otra empresa
    (orden(planned_date_start="2026-11-13 23:00:00"), False),                         # empezaba hace más de 3 días
    (orden(planned_date_start="2026-11-14 00:00:00"), True),
    (orden(planned_date_start="2026-12-01 23:00:00"), True),                          # dentro de 14 días
    (orden(planned_date_start="2026-12-02 00:00:00"), False),
    (orden(planned_date_start=False, tms_transport_order_creation_date="2026-11-15 10:00:00"), True),
    (orden(planned_date_start=False, tms_transport_order_creation_date="2026-11-01 10:00:00"), False),
])
def test_le_llegan_las_emitidas_o_aprobadas_sin_terminar_y_en_fechas(registro, entra):
    assert cumple(registro, dominio_viajes([900], [1, 7], HOY)) is entra


def test_una_empezada_en_la_app_sigue_aunque_quede_atras_pero_solo_si_es_suya_y_abierta():
    antigua = orden(id=5, planned_date_start="2026-10-20 06:00:00")
    assert not cumple(antigua, dominio_viajes([900], [1, 7], HOY))
    assert cumple(antigua, dominio_viajes([900], [1, 7], HOY, incluir=[5]))
    assert not cumple({**antigua, "driver_id": 901}, dominio_viajes([900], [1, 7], HOY, incluir=[5]))
    assert not cumple({**antigua, "state": "1_done"}, dominio_viajes([900], [1, 7], HOY, incluir=[5]))


def test_comprobar_una_orden_no_mira_fechas_pero_si_conductor_y_estado():
    d = dominio_viajes([900], [1, 7], tarea=5)
    assert cumple(orden(id=5, planned_date_start="2026-01-01 00:00:00"), d)
    assert not cumple(orden(id=6), d)
    assert not cumple(orden(id=5, driver_id=901), d)
    assert not cumple(orden(id=5, state="1_canceled"), d)


@pytest.mark.parametrize("conductores", [[], [0], [-3]])
def test_sin_conductor_no_se_lee_nada(conductores):
    with pytest.raises(ValueError):
        dominio_viajes(conductores, [1, 7], HOY)


def test_el_cliente_de_odoo_solo_lee_tareas_con_el_dominio_fijo():
    llamadas = []

    class Falso(OdooClient):
        def __init__(self):
            self.s = type("S", (), {"company_ids": [1, 7]})()

        def _call(self, model, method, args, kwargs=None):
            llamadas.append((model, method, args, kwargs))
            return []
    c = Falso()
    c.ordenes_de_conductores([900], HOY, [5], limite=40)
    c.orden_de_conductor(900, 5)
    assert [(m, f) for m, f, *_ in llamadas] == [("project.task", "search_read")] * 2
    assert llamadas[0][2] == [dominio_viajes([900], [1, 7], HOY, [5])]
    assert llamadas[0][3]["fields"] == CAMPOS_VIAJE and llamadas[0][3]["limit"] == 41
    assert llamadas[1][2] == [dominio_viajes([900], [1, 7], tarea=5)]
    for campo in ("amount", "price", "invoice", "salary", "wage"):
        assert not any(campo in f for f in CAMPOS_VIAJE)


# ---- pasos ----------------------------------------------------------------------------------------------------

def test_el_siguiente_paso_va_en_orden_y_las_incidencias_no_cuentan():
    assert viajes.siguiente_paso([]) == "llegada_carga"
    assert viajes.siguiente_paso([{"estado": "llegada_carga"}, {"estado": "incidencia"}]) == "cargando"
    assert viajes.siguiente_paso([{"estado": p} for p in viajes.PASOS[:3]]) == "llegada_descarga"
    assert viajes.siguiente_paso([{"estado": p} for p in viajes.PASOS]) is None


def test_la_lista_de_pasos_es_la_misma_en_python_la_web_y_la_base_de_datos():
    ts = (RAIZ / "src/lib/viajes.ts").read_text(encoding="utf-8")
    web = re.search(r"export const PASOS = \[([^\]]+)\]", ts).group(1)
    assert re.findall(r'"([a-z_]+)"', web) == viajes.PASOS
    sql = next((RAIZ / "supabase/migrations").glob("*_viajes.sql")).read_text(encoding="utf-8")
    cadena = re.findall(r"when '([a-z_]*)' then '([a-z_]+)'", sql)
    assert [b for _, b in cadena] == viajes.PASOS and [a for a, _ in cadena] == ["", *viajes.PASOS[:-1]]


def test_avisos_para_trafico():
    ahora = datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)
    hace = lambda h: (ahora - timedelta(hours=h)).isoformat()
    assert viajes.aviso_seguimiento({}, {"estado": "cargando", "momento": hace(4)}, ahora) == "Lleva 4 h en este paso"
    assert viajes.aviso_seguimiento({}, {"estado": "cargando", "momento": hace(1)}, ahora) is None
    assert viajes.aviso_seguimiento({}, {"estado": "cargado", "momento": hace(20)}, ahora) is None
    assert viajes.aviso_seguimiento({}, {"estado": "descargado", "momento": hace(100)}, ahora) is None
    assert viajes.aviso_seguimiento({"inicio": hace(3)}, None, ahora) == "No ha marcado la llegada a carga"
    assert viajes.aviso_seguimiento({"inicio": hace(1)}, None, ahora) is None


def test_las_fechas_de_odoo_llegan_en_utc_con_zona():
    f = viajes.ficha_orden({"id": 1, "planned_date_start": "2026-11-17 07:30:00", "company_id": [7, "TRANSARGI"],
                            "sale_order_id": [3, "S2621473"], "driver_id": [900, "X"]})
    assert f["inicio"] == "2026-11-17T07:30:00Z" and f["empresa"] == "transargi" and f["pedido"] == "S2621473"
    assert "driver_id" not in f and "conductor" not in f


# ---- rutas ----------------------------------------------------------------------------------------------------

@pytest.fixture
def con_sesion(monkeypatch):
    import servicios.auth as auth
    monkeypatch.setattr(auth, "supabase_configurado", lambda: True)

    def entrar(*permisos, uid="yo"):
        monkeypatch.setattr(auth, "usuario_actual", lambda t: Usuario(uid, "Yo", tuple(permisos)))
    return entrar


CAB = {"Authorization": "Bearer x"}
TAREA = {"id": 77, "name": "OT/77", "company_id": [1, "STINSA"], "driver_id": [900, "CONDUCTOR"], "partner_id": [5, "Cliente"],
         "shipping_origin_id": [6, "Origen"], "shipping_destination_id": [7, "Destino"], "planned_date_start": "2026-11-17 06:00:00",
         "state": "01_in_progress", "stage_id": [1, "Nuevo"], "tms_transport_order_creation_date": "2026-11-16 08:00:00",
         "sale_order_id": [3, "S2621473"]}


class OdooFalso:
    def __init__(self):
        self.pedidas = []

    def ordenes_de_conductores(self, conductores, hoy=None, incluir=None, limite=60):
        self.pedidas.append(("lista", sorted(conductores), sorted(incluir or [])))
        return [{**TAREA, "driver_id": [c, "X"], "id": 77 + i} for i, c in enumerate(sorted(conductores))]

    def orden_de_conductor(self, conductor, tarea):
        self.pedidas.append(("una", conductor, tarea))
        return {**TAREA, "id": tarea} if tarea == 77 and conductor == 900 else None


@pytest.fixture
def odoo(monkeypatch):
    falso = OdooFalso()

    @contextmanager
    def conexion():
        yield falso
    monkeypatch.setattr(viajes, "conexion", conexion)
    return falso


def supabase(monkeypatch, enlace=900, confirmado=True, pasos=(), personas=()):
    leidas = []

    def leer(token, tabla, params):
        assert token == "x"   # siempre con la sesión de quien mira: Supabase decide qué ve
        leidas.append((tabla, params))
        if tabla == "usuarios":
            return [{"odoo_conductor_id": enlace, "vinculo_confirmado": "2026-11-17T08:00:00Z" if confirmado else None}]
        if tabla == "rpc/viajes_en_curso":
            return [{"usuario_id": "yo", "odoo_task_id": 12}, {"usuario_id": "otro", "odoo_task_id": 13}]
        if tabla == "viajes_estados":
            return list(pasos)
        if tabla == "rpc/viajes_conductores_a_mi_cargo":
            return list(personas)
        if tabla == "rpc/viajes_ultimo_estado":
            return [{"usuario_id": "ana", "odoo_task_id": 77, "estado": "cargando", "momento": "2026-11-17T06:00:00Z",
                     "incidencias": 1, "ultima_incidencia": "2026-11-17T06:30:00Z", "nota": "Muelle lleno"}]
        raise AssertionError(tabla)
    monkeypatch.setattr(viajes.supa, "leer", leer)
    return leidas


@pytest.mark.parametrize("ruta", ["/api/chofer/viajes", "/api/chofer/viajes/seguimiento", "/api/chofer/viajes/77"])
def test_las_rutas_exigen_sesion(con_sesion, ruta):
    assert TestClient(app).get(ruta).status_code == 401


@pytest.mark.parametrize("ruta, permisos", [
    ("/api/chofer/viajes", ("chofer.usar", "deca.usar", "viajes.seguimiento")),
    ("/api/chofer/viajes/77", ("chofer.usar", "viajes.seguimiento")),
    ("/api/chofer/viajes/seguimiento", ("viajes.usar", "equipo.ver", "chofer.usar")),
])
def test_las_rutas_exigen_su_permiso(con_sesion, monkeypatch, ruta, permisos):
    con_sesion(*permisos)
    monkeypatch.setattr(viajes.supa, "leer", lambda *a: pytest.fail("Sin permiso no se lee nada"))
    assert TestClient(app).get(ruta, headers=CAB).status_code == 403


def test_el_conductor_sale_del_enlace_y_no_de_fuera(con_sesion, monkeypatch, odoo):
    con_sesion("viajes.usar")
    leidas = supabase(monkeypatch, pasos=[{"odoo_task_id": 77, "estado": "llegada_carga", "nota": None, "momento": "2026-11-17T06:00:00Z"}])
    r = TestClient(app).get("/api/chofer/viajes?conductor=901&driver_id=901&conductores=901&usuario_id=otro", headers=CAB)
    assert r.status_code == 200
    assert odoo.pedidas == [("lista", [900], [12])]          # su enlace; y de lo empezado, solo lo suyo
    usuarios = next(p for t, p in leidas if t == "usuarios")
    assert usuarios["id"] == "eq.yo"
    estados = next(p for t, p in leidas if t == "viajes_estados")
    assert estados["usuario_id"] == "eq.yo" and estados["odoo_task_id"] == "in.(77)"
    [o] = r.json()["ordenes"]
    assert o["id"] == 77 and o["siguiente"] == "cargando" and not o["terminado"] and len(o["pasos"]) == 1


def test_comprobar_una_orden_usa_el_enlace_y_rechaza_las_ajenas(con_sesion, monkeypatch, odoo):
    con_sesion("viajes.usar")
    supabase(monkeypatch)
    c = TestClient(app)
    assert c.get("/api/chofer/viajes/77?conductor=901", headers=CAB).status_code == 200
    r = c.get("/api/chofer/viajes/78", headers=CAB)
    assert r.status_code == 404 and "ya no está entre tus viajes" in r.json()["error"]
    assert odoo.pedidas == [("una", 900, 77), ("una", 900, 78)]
    assert c.get("/api/chofer/viajes/0", headers=CAB).status_code == 400      # validación: la app responde 400
    assert c.get(f"/api/chofer/viajes/{2**31}", headers=CAB).status_code == 400


@pytest.mark.parametrize("enlace, confirmado", [(None, False), (900, False), (None, True)])
def test_sin_enlace_confirmado_lo_dice_claro_y_no_consulta_odoo(con_sesion, monkeypatch, enlace, confirmado):
    con_sesion("viajes.usar")
    supabase(monkeypatch, enlace=enlace, confirmado=confirmado)
    monkeypatch.setattr(viajes, "conexion", lambda: pytest.fail("No debe consultar Odoo"))
    c = TestClient(app)
    r = c.get("/api/chofer/viajes", headers=CAB)
    assert r.status_code == 200
    assert r.json()["enlazado"] is False and "encargado tiene que confirmar tu ficha de Odoo" in r.json()["aviso"]
    r = c.get("/api/chofer/viajes/77", headers=CAB)
    assert r.status_code == 409 and "encargado" in r.json()["error"]


def test_seguimiento_solo_de_los_conductores_que_da_supabase(con_sesion, monkeypatch, odoo):
    con_sesion("viajes.seguimiento")
    supabase(monkeypatch, personas=[{"id": "ana", "nombre": "Ana", "odoo_conductor_id": 900},
                                    {"id": "luis", "nombre": "Luis", "odoo_conductor_id": 950},
                                    {"id": "raro", "nombre": "Sin enlace", "odoo_conductor_id": None}])
    r = TestClient(app).get("/api/chofer/viajes/seguimiento?conductores=1,2,3", headers=CAB)
    assert r.status_code == 200
    assert odoo.pedidas == [("lista", [900, 950], [])]       # «otro» no está entre sus personas: su viaje no se rescata
    datos = r.json()
    assert [p["id"] for p in datos["personas"]] == ["ana", "luis"]
    ana = next(o for o in datos["ordenes"] if o["persona"]["id"] == "ana")
    assert (ana["estado"], ana["incidencias"], ana["nota"]) == ("cargando", 1, "Muelle lleno")
    luis = next(o for o in datos["ordenes"] if o["persona"]["id"] == "luis")
    assert luis["estado"] is None


def test_seguimiento_sin_personas_no_consulta_odoo(con_sesion, monkeypatch):
    con_sesion("viajes.seguimiento")
    supabase(monkeypatch)
    monkeypatch.setattr(viajes, "conexion", lambda: pytest.fail("No debe consultar Odoo"))
    r = TestClient(app).get("/api/chofer/viajes/seguimiento", headers=CAB)
    assert r.status_code == 200 and r.json()["ordenes"] == []


def test_sin_odoo_real_no_hay_datos_de_ejemplo(monkeypatch):
    monkeypatch.setenv("ODOO_MODE", "mock")
    with pytest.raises(Exception) as e:
        with viajes.conexion():
            pass
    assert "conexión real con Odoo" in str(e.value)
