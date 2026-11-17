from copy import deepcopy
from dataclasses import replace
import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient
from servicios.main import app
from servicios import auth, sincronizacion as sync
from servicios.auth import Usuario
from servicios.config import get_settings
from servicios.errors import AppError
from servicios.odoo_client import OdooClient, CAMPOS_EMPLEADO_EDITABLES, permitido
from servicios.organizacion import DatosFicha


def test_lista_exacta_autorizada():
    assert CAMPOS_EMPLEADO_EDITABLES == {'name','mobile_phone','work_phone','work_email','work_location_id','department_id','job_id','parent_id'}
    assert permitido('hr.employee','write')
    assert not any(permitido('hr.employee',m) for m in ('create','unlink','copy','toggle_active'))


@pytest.mark.parametrize('permisos',[(),('organizacion.ver',),('admin.usuarios',),('organizacion.editar',)])
def test_editar_exige_ambos_permisos(monkeypatch,permisos):
    monkeypatch.setattr(auth,'supabase_configurado',lambda:True)
    monkeypatch.setattr(auth,'usuario_actual',lambda t:Usuario('u','U',permisos))
    assert TestClient(app).get('/api/odoo/empleados/1/edicion',headers={'Authorization':'Bearer x'}).status_code==403


def test_body_rechaza_empresa_y_datos_privados():
    with pytest.raises(ValidationError):
        DatosFicha(name='A',mobile_phone='',work_phone='',work_email='',work_location_id=None,department_id=None,job_id=None,parent_id=None,company_id=7)


@pytest.fixture
def cliente(monkeypatch):
    c=OdooClient(get_settings())
    antes={'version':'v1','empresa':1,'valores':{'name':'Antes','job_id':False}}
    estado=deepcopy(antes)
    llamadas=[]
    monkeypatch.setattr(c,'ficha_editable_empleado',lambda i:deepcopy(estado))
    monkeypatch.setattr(c,'opciones_edicion_empleado',lambda empresa:{'job_id':[{'id':5}]})
    def llamada(modelo,metodo,args,kwargs=None):
        llamadas.append((modelo,metodo,args))
        estado['valores'].update(args[1]);estado['version']='v2'
    monkeypatch.setattr(c,'_call',llamada)
    yield c,antes,estado,llamadas
    c._http.close();c._anon.close()


def test_escribe_y_lee_de_vuelta(cliente):
    c,antes,estado,llamadas=cliente
    assert c.editar_ficha_empleado(1,{'name':'Después'},antes)['valores']['name']=='Después'
    assert llamadas==[('hr.employee','write',[[1],{'name':'Después'}])]


def test_conflicto_no_sobrescribe(cliente):
    c,antes,estado,llamadas=cliente
    estado['version']='otro'
    with pytest.raises(AppError):c.editar_ficha_empleado(1,{'name':'Después'},antes)
    assert not llamadas


@pytest.mark.parametrize('cambios',[{'company_id':7},{'job_id':99},{'private_phone':'123'}])
def test_rechaza_campos_y_referencias_fuera_de_empresa(cliente,cambios):
    c,antes,estado,llamadas=cliente
    with pytest.raises(AppError):c.editar_ficha_empleado(1,cambios,antes)
    assert not llamadas


@pytest.mark.parametrize('modo,esperado,veces',[('prueba','simulado',0),('real','enviado',1)])
def test_cola_no_reenvia_y_respeta_prueba(monkeypatch,modo,esperado,veces):
    fila={'id':'x','estado':'pendiente','modo':modo,'empleado_id':1,'antes':{},'cambios':{'name':'A'}}
    escrituras=[]
    monkeypatch.setattr(sync.supa,'leer',lambda *a:[deepcopy(fila)])
    def actualizar(token,tabla,filtro,datos):
        if filtro.get('estado')!='eq.'+fila['estado']:return 0
        fila.update(datos);return 1
    monkeypatch.setattr(sync.supa,'actualizar',actualizar)
    class Odoo:
        def editar_ficha_empleado(self,*args):escrituras.append(args);return {'id':1}
    monkeypatch.setattr(sync,'_odoo',lambda:Odoo())
    assert sync.enviar_edicion_empleado('x')['estado']==esperado
    assert sync.enviar_edicion_empleado('x')['estado']==esperado
    assert len(escrituras)==veces
