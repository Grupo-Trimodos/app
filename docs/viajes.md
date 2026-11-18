# Mis viajes

Autorizado por Félix el 17-11-2026 (excepción a la fase de piloto). El chófer ve en la app sus órdenes de transporte de
Odoo y marca cuándo llega, carga y descarga; tráfico ve en qué punto va cada viaje. **Los pasos se guardan solo en la
app (Supabase); a Odoo no se envía nada.**

## Pantallas y permisos

| Pantalla | Permiso | Quién lo tiene (migración `20261117120000_viajes.sql`) |
|---|---|---|
| `/viajes` y la tarjeta «Mis viajes» del inicio de chóferes | `viajes.usar` (de puesto) | Chófer |
| `/viajes/seguimiento` | `viajes.seguimiento` | Administrador y Responsable (en sus centros) |

Un perfil «Tráfico» se crea desde Administración → Perfiles marcando `viajes.seguimiento`; si debe ver todos los
centros, con «todos los centros».

## Cuándo le llega una orden al chófer

Lectura en directo de `project.task` (`OdooClient.ordenes_de_conductores`, dominio fijo `dominio_viajes` en
`servicios/odoo_client.py`, solo `search_read`):

- `is_transport_order` y empresa configurada (`ODOO_COMPANY_IDS`);
- `driver_id` = el contacto conductor **de quien mira**, sacado de `public.usuarios.odoo_conductor_id` y solo si su
  encargado ha confirmado el enlace (`vinculo_confirmado`). Nunca llega del navegador: ninguna ruta lo acepta;
- **emitida** (`tms_transport_order_creation_date` con fecha: Odoo ya generó la orden) **o aprobada**
  (`state = 03_approved`, hoy no se usa);
- **sin terminar**: `state` no es `1_done` ni `1_canceled`, y la etapa no está plegada (`stage_id.fold`: Realizado,
  Facturable, Finalizados, Cancelado y Fusionar). Se usa el plegado y no el nombre porque el nombre viene traducido;
- **en fechas**: inicio previsto (`planned_date_start`) desde hace 3 días hasta dentro de 14; sin inicio previsto, emitida
  hace 3 días o menos. Además siguen las que el chófer ha empezado en la app y no ha descargado (hasta 30 días), aunque
  su fecha haya quedado atrás.

Medido el 17-11-2026 (solo lectura): en Odoo casi ninguna orden se cierra (538 emitidas con chófer siguen «Nuevo» y
«En proceso», algunas de hace meses). Con la ventana, 50 órdenes de 22 conductores, como mucho 7 por conductor. Por eso,
para la app, un viaje termina cuando el chófer marca «Descargado».

De cada orden se enseña: cliente, origen → destino (y destino final y puertos si los hay), fecha prevista, referencia de
carga y del cliente, remolque, pedido y si lleva servicio de descarga. Ni precios ni facturación.

## Lo que se guarda en Supabase

`public.viajes_estados`: una fila por paso, solo se añade.

| Columna | Qué es |
|---|---|
| `odoo_task_id` | la orden (`project.task`) |
| `usuario_id` | quien lo marca (siempre él mismo) |
| `odoo_conductor_id` | su contacto conductor en ese momento (lo pone la base de datos) |
| `estado` | `llegada_carga` → `cargando` → `cargado` → `llegada_descarga` → `descargando` → `descargado`, o `incidencia` |
| `nota` | obligatoria en la incidencia, hasta 200 letras |
| `momento`, `creado` | la hora la pone la base de datos (no se puede antedatar) |

- Los pasos van **en orden**: lo comprueba la acción de la web (`src/app/viajes/acciones.ts`) y otra vez un disparador
  (`privado.viajes_estado_al_alta`). No se puede marcar «Descargado» sin «Cargado» ni repetir un paso. Una incidencia
  vale en cualquier momento. La lista de pasos está igual en `src/lib/viajes.ts`, `servicios/viajes.py` y la migración
  (un test lo comprueba).
- **Nadie cambia ni borra** un paso (ni el servidor). Un paso marcado por error se aclara con una incidencia. El último
  paso, «Descargado», pide confirmarlo.
- RLS: el chófer añade y ve los suyos (con `viajes.usar`, activo y enlace confirmado); quien tiene `viajes.seguimiento`
  ve los de las personas sobre las que tiene ese permiso (`privado.puedo_sobre`, calculado una vez por consulta en
  `privado.viajes_a_mi_cargo`). Sin sesión, nada.
- **Límite:** la base de datos no puede preguntar a Odoo si la orden es de ese chófer. La acción de la web lo comprueba
  antes de guardar llamando a `GET /api/chofer/viajes/{tarea}` (la orden, con su conductor, abierta). Quien se salte la
  web solo podría añadir pasos a su propio nombre, y esos pasos no salen en ninguna pantalla salvo que la orden sea de
  verdad suya en Odoo (las pantallas cruzan cada orden de Odoo con los pasos de su conductor).

## API (`servicios/chofer.py` → `servicios/viajes.py`)

| Ruta | Permiso | Qué devuelve |
|---|---|---|
| `GET /api/chofer/viajes` | `viajes.usar` | Sus órdenes con sus pasos y el siguiente. Sin enlace confirmado: `enlazado: false` y «Tu encargado tiene que confirmar tu ficha de Odoo» (no consulta Odoo). |
| `GET /api/chofer/viajes/{tarea}` | `viajes.usar` | Esa orden si es suya y sigue abierta; si no, 404. Sin enlace, 409. |
| `GET /api/chofer/viajes/seguimiento` | `viajes.seguimiento` | Órdenes de los chóferes que sigue (`rpc/viajes_conductores_a_mi_cargo`, solo con enlace confirmado), su último paso, sus incidencias y un aviso si lleva mucho en un paso (llegada 2 h, carga o descarga 3 h, en camino 48 h) o no ha marcado la llegada 2 h después del inicio previsto. |

Todas leen Supabase con la sesión de quien mira. Sin conexión real con Odoo (`ODOO_MODE` distinto de `real`) responden
que hace falta, sin datos de ejemplo. Sin cobertura, la pantalla lo dice y ofrece volver a intentarlo (no hay modo sin
conexión).

## DECA

«Abrir en DECA» lleva a `/deca/?pedido=…&empresa=…`, que busca el pedido como si se escribiera a mano. DECA abre la
orden **más reciente** del pedido y un pedido puede tener varias (16 de 50 el 17-11-2026), así que el botón solo sale
cuando DECA abriría justo esa orden (`OdooClient.tareas_que_abre_deca`, la misma regla que DECA). Si no, la pantalla
pide escanear el QR de la orden en DECA. Abrir DECA por el id de la orden exige cambiar `resolve`, que prepara lo que
DECA escribe en Odoo: queda propuesto, pendiente de permiso y del Odoo de pruebas.

## Comprobar

```bash
.venv/bin/python -m pytest -q tests/test_viajes.py
python3 -m scripts.prueba_viajes_db --contenedor trimodos-jornada-pruebas [--como-produccion]
.venv/bin/python -X utf8 -m scripts.prueba_navegador   # el enlace de DECA
```
