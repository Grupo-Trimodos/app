"""Automatizaciones · gasóleo: lectura de la Excel del Ministerio, enlace, fecha, copia en memoria y permisos."""
import datetime as dt
import io

import httpx
import openpyxl
import pytest
from fastapi.testclient import TestClient

from servicios import auth, gasoleo
from servicios.auth import Usuario
from servicios.errors import AppError

EPOCH = dt.datetime(1899, 12, 30)


def _serial(d: dt.date) -> int:
    return (dt.datetime(d.year, d.month, d.day) - EPOCH).days


def excel(semanas=60, con_referencia=True, hoja="PRECIOS_DEL_GASOLEO") -> bytes:
    """Excel con el formato del Ministerio: fechas en D, PVP en E, PVP sin IVA en H, IEH en I, PAI en J, devolución en K;
    y en «PRECIOS DE REFERENCIA», fecha en B, Pmed ≥ 7,5 t en C y < 7,5 t en D."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = hoja
    ws.append(["", "", "", "Fecha", "PVP", "x", "y", "PVP sin IVA", "IEH", "PAI", "Devolución"])   # cabecera: se salta
    ws.append([None, None, None, dt.datetime(2017, 12, 25), 1.1, None, None, 0.9, 0.36, 0.5, 0.037])  # antes de 2018: fuera
    inicio = dt.date(2018, 1, 1)
    for i in range(semanas):
        d = inicio + dt.timedelta(weeks=i)
        fecha = dt.datetime(d.year, d.month, d.day) if i % 2 else _serial(d)   # unas como fecha y otras como número
        pvp = 1.2 + i / 1000
        ws.append([None, None, None, fecha, pvp, None, None, f"{pvp / 1.21:.6f}".replace(".", ","), 0.367, 0.6 + i / 1000, 0.037])
    ws.append([None, None, None, dt.datetime(2030, 1, 7), None, None, None, 1.0, 0.3, 0.6, 0])   # sin PVP: fuera
    if con_referencia:
        ref = wb.create_sheet("PRECIOS DE REFERENCIA")
        ref.append(["", "Fecha", "Pmed >= 7,5", "Pmed < 7,5"])
        for i in range(0, semanas, 3):
            d = inicio + dt.timedelta(weeks=i)
            ref.append([None, dt.datetime(d.year, d.month, d.day), 0.95 + i / 1000, 0.99 + i / 1000])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------- Excel

def test_lee_la_excel_con_el_formato_de_data_json():
    filas = gasoleo.leer_excel(excel())
    assert len(filas) == 60
    primera, segunda = filas[0], filas[1]
    assert primera[0] == 43101                                   # 01/01/2018, leída como número
    assert segunda[0] == 43108                                   # 08/01/2018, leída como fecha
    assert primera[1] == 1.2 and primera[4] == 0.6 and primera[5] == 0.037 and primera[3] == 0.367
    assert primera[2] == round(1.2 / 1.21, 6)                    # «0,991736» con coma decimal
    assert primera[6:] == [0.95, 0.99]                           # Pmed de la hoja de referencia
    assert segunda[6:] == [0, 0]                                 # semana sin Pmed: ceros, como el original
    assert [f[0] for f in filas] == sorted(f[0] for f in filas)
    assert all(len(f) == 8 for f in filas)


def test_excel_sin_hoja_de_referencia_y_con_errores():
    assert gasoleo.leer_excel(excel(con_referencia=False))[0][6:] == [0, 0]
    with pytest.raises(gasoleo.MinisterioError, match="PRECIOS_DEL_GASOLEO"):
        gasoleo.leer_excel(excel(hoja="OTRA"))
    with pytest.raises(gasoleo.MinisterioError, match="solo 10 semanas"):
        gasoleo.leer_excel(excel(semanas=10))
    with pytest.raises(gasoleo.MinisterioError):
        gasoleo.leer_excel(b"<html>no es una excel</html>")


def test_num_y_a_serial():
    assert gasoleo.num("1,2345678912") == 1.2345679
    assert gasoleo.num("") is None and gasoleo.num(None) is None and gasoleo.num("n/d") is None
    assert gasoleo.a_serial(dt.date(2018, 1, 1)) == 43101 and gasoleo.a_serial("43101") == 43101
    assert gasoleo.a_serial(43101.0) == 43101 and gasoleo.a_serial("hola") is None


# ---------------------------------------------------------------- enlace y fecha

@pytest.mark.parametrize("nombre, fecha", [
    ("preciogasoleosemanalweb-28102026.xlsx", "2026-10-28"),
    ("preciogasoleosemanalweb11-11-26.xlsx", "2026-11-11"),
    ("precio_gasoleo_05.11.2026.xls", "2026-11-05"),
])
def test_busca_el_enlace_en_sus_dos_formatos_y_saca_la_fecha(nombre, fecha):
    pagina = (f'<a href="/recursos_mfom/otro/informe.xlsx">Otro</a>'
              f'<a href="/recursos_mfom/comodin/recursos/{nombre}">Evolución semanal</a>')
    enlace = gasoleo.buscar_enlace(pagina)
    assert enlace == f"/recursos_mfom/comodin/recursos/{nombre}"
    assert gasoleo.fecha_del_nombre(enlace) == fecha


def test_enlace_de_reserva_y_sin_enlace():
    assert gasoleo.buscar_enlace('<a href="/x/tabla-gasóleo.xlsx">') == "/x/tabla-gasóleo.xlsx"
    assert gasoleo.buscar_enlace('<a href="/x/unica.XLSX">') == "/x/unica.XLSX"           # una sola Excel
    assert gasoleo.buscar_enlace('<a href="/a.xlsx"><a href="/b.xlsx">') is None          # varias y ninguna de gasóleo
    assert gasoleo.buscar_enlace("<p>sin enlaces</p>") is None


def test_fecha_no_reconocida_es_la_de_hoy():
    hoy = dt.date(2026, 11, 17)
    assert gasoleo.fecha_del_nombre("https://x.gob.es/precio.xlsx", hoy) == "2026-11-17"
    assert gasoleo.fecha_del_nombre("https://x.gob.es/precio-32132026.xlsx", hoy) == "2026-11-17"   # 32/13: no existe


def test_solo_descarga_de_webs_de_la_administracion():
    assert gasoleo._url_de_la_excel("/recursos/p.xlsx") == "https://www.transportes.gob.es/recursos/p.xlsx"
    with pytest.raises(gasoleo.MinisterioError):
        gasoleo._url_de_la_excel("https://otra-web.com/precio-gasoleo.xlsx")
    with pytest.raises(gasoleo.MinisterioError):
        gasoleo._url_de_la_excel("http://www.transportes.gob.es/p.xlsx")


# ---------------------------------------------------------------- descarga y copia en memoria

class Ministerio:
    """Simula la web del Ministerio: la página con el enlace y la Excel. `caido` = no responde."""

    def __init__(self):
        self.caido = False
        self.peticiones = []
        self.nombre = "preciogasoleosemanalweb11-11-26.xlsx"
        self.pagina = None   # otra página (p. ej. sin el enlace)

    def handler(self, request: httpx.Request):
        self.peticiones.append(str(request.url))
        if self.caido:
            raise httpx.ConnectTimeout("sin respuesta")
        if request.url.path.endswith(".xlsx"):
            return httpx.Response(200, content=excel())
        return httpx.Response(200, text=self.pagina or f'<a href="/recursos_mfom/comodin/recursos/{self.nombre}">Excel</a>')


@pytest.fixture
def ministerio(monkeypatch):
    m = Ministerio()
    monkeypatch.setattr(gasoleo, "_cliente_http", lambda: httpx.Client(transport=httpx.MockTransport(m.handler)))
    reloj = {"t": 1000.0}
    monkeypatch.setattr(gasoleo, "_ahora", lambda: reloj["t"])
    gasoleo._cache.update(datos=None, hasta=0.0, fallo_hasta=0.0)
    m.reloj = reloj
    yield m
    gasoleo._cache.update(datos=None, hasta=0.0, fallo_hasta=0.0)


def test_descarga_y_guarda_copia_dos_horas(ministerio):
    d = gasoleo.precios_gasoleo()
    assert d["fileDate"] == "2026-11-11" and d["aviso"] is None
    assert d["source"] == "https://www.transportes.gob.es/recursos_mfom/comodin/recursos/preciogasoleosemanalweb11-11-26.xlsx"
    assert len(d["rows"]) == 60 and isinstance(d["checkedAt"], int)
    assert len(ministerio.peticiones) == 2                       # página + Excel
    ministerio.reloj["t"] += 2 * 3600 - 1
    assert gasoleo.precios_gasoleo() is d                        # dentro de las 2 horas: sin volver al Ministerio
    assert len(ministerio.peticiones) == 2
    ministerio.reloj["t"] += 2
    ministerio.nombre = "preciogasoleosemanalweb-18112026.xlsx"
    assert gasoleo.precios_gasoleo()["fileDate"] == "2026-11-18"  # pasadas: vuelve a descargar
    assert len(ministerio.peticiones) == 4


def test_si_el_ministerio_falla_devuelve_la_ultima_copia_con_aviso(ministerio):
    buena = gasoleo.precios_gasoleo()
    ministerio.reloj["t"] += 2 * 3600 + 1
    ministerio.caido = True
    d = gasoleo.precios_gasoleo()
    assert d["rows"] == buena["rows"] and d["fileDate"] == buena["fileDate"] and d["checkedAt"] == buena["checkedAt"]
    assert "últimos precios descargados" in d["aviso"]
    n = len(ministerio.peticiones)
    ministerio.reloj["t"] += 60
    assert gasoleo.precios_gasoleo()["aviso"]                    # no se le vuelve a esperar en cada visita
    assert len(ministerio.peticiones) == n
    ministerio.reloj["t"] += 10 * 60
    ministerio.caido = False
    assert gasoleo.precios_gasoleo()["aviso"] is None            # vuelve: datos nuevos, sin aviso


def test_sin_ninguna_copia_error_claro(ministerio):
    ministerio.caido = True
    with pytest.raises(AppError) as e:
        gasoleo.precios_gasoleo()
    assert e.value.status == 503 and e.value.code == "ministerio_no_disponible"
    assert "Ministerio" in e.value.message


def test_sin_copia_el_fallo_se_recuerda_un_minuto(ministerio):
    ministerio.caido = True
    with pytest.raises(AppError):
        gasoleo.precios_gasoleo()
    n = len(ministerio.peticiones)
    ministerio.reloj["t"] += 59
    with pytest.raises(AppError) as e:
        gasoleo.precios_gasoleo()                                # responde el 503 sin volver al Ministerio
    assert e.value.status == 503 and len(ministerio.peticiones) == n
    ministerio.reloj["t"] += 2
    ministerio.caido = False
    assert gasoleo.precios_gasoleo()["aviso"] is None            # pasado el minuto, se vuelve a intentar
    assert len(ministerio.peticiones) == n + 2


def test_la_descarga_entera_tiene_un_plazo_total(ministerio):
    """La página tarda 8 s en trozos de 2 s: la Excel solo tiene los 7 s que quedan y, si se pasa, se corta."""
    reloj = ministerio.reloj
    tiempos = []

    def lento(segundos, trozos):
        for t in trozos:
            reloj["t"] += segundos
            yield t

    def handler(request):
        ministerio.peticiones.append(str(request.url))
        tiempos.append(request.extensions["timeout"])
        if request.url.path.endswith(".xlsx"):
            contenido = excel()
            return httpx.Response(200, content=lento(3, [contenido[i:i + 1000] for i in range(0, len(contenido), 1000)]))
        return httpx.Response(200, content=lento(2, [b'<a href="/r/preciogasoleosemanalweb11-11-26.xlsx">'] + [b" "] * 3))

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        inicio = reloj["t"]
        with pytest.raises(gasoleo.MinisterioError, match="tarda demasiado"):
            limite = inicio + gasoleo.PLAZO_TOTAL
            html = gasoleo._bajar(http, gasoleo.PAGINA, limite)
            assert reloj["t"] - inicio == 8
            gasoleo._bajar(http, "https://www.transportes.gob.es/r/preciogasoleosemanalweb11-11-26.xlsx", limite)
    assert html.startswith(b"<a href")
    assert tiempos[0]["read"] == 8 and tiempos[0]["connect"] == 5      # al empezar: las esperas normales
    assert tiempos[1]["read"] == 7 and tiempos[1]["connect"] == 5       # la Excel: solo lo que queda
    assert reloj["t"] - inicio <= gasoleo.PLAZO_TOTAL + 3               # se corta en el primer trozo pasado el plazo


def test_sigue_las_redirecciones_dentro_del_plazo(ministerio, monkeypatch):
    def handler(request):
        ministerio.peticiones.append(str(request.url))
        if request.url.path == "/movida.xlsx":
            return httpx.Response(302, headers={"Location": "/recursos/preciogasoleosemanalweb11-11-26.xlsx"})
        if request.url.path.endswith(".xlsx"):
            return httpx.Response(200, content=excel())
        return httpx.Response(200, text='<a href="/movida.xlsx">Excel precio gasoleo</a>')

    monkeypatch.setattr(gasoleo, "_cliente_http", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    d = gasoleo.precios_gasoleo()
    assert len(d["rows"]) == 60 and ministerio.peticiones[-1].endswith("/recursos/preciogasoleosemanalweb11-11-26.xlsx")

    def bucle(request):
        return httpx.Response(302, headers={"Location": "/otra.xlsx"})

    with httpx.Client(transport=httpx.MockTransport(bucle)) as http:
        with pytest.raises(gasoleo.MinisterioError, match="redirige demasiadas veces"):
            gasoleo._bajar(http, "https://www.transportes.gob.es/otra.xlsx", ministerio.reloj["t"] + 20)


@pytest.mark.parametrize("destino", [
    "https://otra-web.com/preciogasoleo.xlsx",                     # fuera de la Administración
    "http://www.transportes.gob.es/preciogasoleo.xlsx",            # la misma web, sin https
    "https://transportes.gob.es.otra-web.com/preciogasoleo.xlsx",  # se hace pasar por .gob.es
    "https://www.gob.es@otra-web.com/preciogasoleo.xlsx",          # usuario «www.gob.es» en otra web
])
def test_cada_redireccion_tiene_que_ser_https_de_gob_es(ministerio, destino):
    """Las redirecciones se siguen a mano: cada salto se comprueba antes de pedirlo, también el segundo y siguientes."""
    def handler(request):
        ministerio.peticiones.append(str(request.url))
        if request.url.path == "/movida.xlsx":                   # un primer salto bueno, dentro de gob.es
            return httpx.Response(302, headers={"Location": "https://sede.transportes.gob.es/otra-vez.xlsx"})
        return httpx.Response(302, headers={"Location": destino})

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(gasoleo.MinisterioError, match="no es de la web del Ministerio"):
            gasoleo._bajar(http, "https://www.transportes.gob.es/movida.xlsx", ministerio.reloj["t"] + 20)
    assert ministerio.peticiones == ["https://www.transportes.gob.es/movida.xlsx", "https://sede.transportes.gob.es/otra-vez.xlsx"]


def test_no_se_pide_una_primera_direccion_fuera_de_gob_es(ministerio):
    with httpx.Client(transport=httpx.MockTransport(ministerio.handler)) as http:
        with pytest.raises(gasoleo.MinisterioError, match="no es de la web del Ministerio"):
            gasoleo._bajar(http, "https://otra-web.com/preciogasoleo.xlsx", ministerio.reloj["t"] + 20)
    assert ministerio.peticiones == []


def test_no_se_espera_sin_limite_a_otra_descarga(ministerio, monkeypatch):
    monkeypatch.setattr(gasoleo, "ESPERA_CERROJO", 0.01)
    assert gasoleo._cerrojo.acquire(timeout=1)                   # otra visita está descargando
    try:
        with pytest.raises(AppError) as e:                       # sin copia: el mensaje claro, sin esperar ni descargar
            gasoleo.precios_gasoleo()
        assert e.value.status == 503 and ministerio.peticiones == []
    finally:
        gasoleo._cerrojo.release()
    buena = gasoleo.precios_gasoleo()
    n = len(ministerio.peticiones)
    ministerio.reloj["t"] += 2 * 3600 + 1                        # copia caducada
    assert gasoleo._cerrojo.acquire(timeout=1)
    try:
        d = gasoleo.precios_gasoleo()                            # con copia: la vieja, con aviso
    finally:
        gasoleo._cerrojo.release()
    assert d["rows"] == buena["rows"] and "Se están descargando" in d["aviso"]
    assert len(ministerio.peticiones) == n


def test_pagina_sin_enlace_es_un_fallo_del_ministerio(ministerio):
    ministerio.pagina = "<p>en obras</p>"
    with pytest.raises(AppError) as e:
        gasoleo.precios_gasoleo()
    assert e.value.status == 503


# ---------------------------------------------------------------- ruta y permisos

@pytest.fixture
def api(monkeypatch, ministerio):
    from servicios.main import app

    def usuario(token):
        if token == "trafico":
            return Usuario(id="u1", nombre="Tráfico", permisos=("automatizaciones.gasoleo",))
        if token == "chofer":
            return Usuario(id="u2", nombre="Conductor", permisos=("chofer.usar", "flota.ver"))
        raise AppError("Tu sesión ha caducado.", 401, "sin_sesion")

    monkeypatch.setattr(auth, "supabase_configurado", lambda: True)
    monkeypatch.setattr(auth, "usuario_actual", usuario)
    return TestClient(app)


def test_ruta_exige_sesion_y_permiso(api, ministerio):
    ruta = "/api/automatizaciones/gasoleo/precios"
    assert api.get(ruta).status_code == 401
    assert api.get(ruta, headers={"Authorization": "Bearer caducado"}).status_code == 401
    r = api.get(ruta, headers={"Authorization": "Bearer chofer"})
    assert r.status_code == 403 and r.json()["codigo"] == "sin_permiso"
    assert ministerio.peticiones == []                           # sin permiso no se llega a consultar
    r = api.get(ruta, headers={"Authorization": "Bearer trafico"})
    assert r.status_code == 200 and len(r.json()["rows"]) == 60
    assert r.headers["cache-control"] == "no-store"


def test_ruta_con_el_ministerio_caido_responde_en_espanol(api, ministerio):
    ministerio.caido = True
    r = api.get("/api/automatizaciones/gasoleo/precios", headers={"Authorization": "Bearer trafico"})
    assert r.status_code == 503 and "precios del gasóleo" in r.json()["error"]


def test_sesion_de_prueba_sin_supabase_no_abre_la_ruta(monkeypatch, ministerio):
    from servicios.main import app
    monkeypatch.setattr(auth, "supabase_configurado", lambda: False)
    monkeypatch.setattr(auth, "get_settings", lambda: type("Config", (), {"mode": "mock"})())
    assert TestClient(app).get("/api/automatizaciones/gasoleo/precios").status_code == 401
    assert ministerio.peticiones == []
