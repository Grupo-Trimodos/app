# Reglas del proyecto (única fuente para Claude Code y Codex)

App interna de Grupo Trimodos. Puesta en marcha en `README.md`; cómo funciona cada parte, en `docs/`. Léelo antes de
cambiar una función.

## Bases del proyecto

1. **Odoo es la base de datos principal y manda en el presente.** Producción es **Odoo 18**
   (`https://stinsa18.tecnativa.net`, base `prod`) desde el 30-10-2026; el Odoo 15 anterior ya no se usa. Datos que
   guarda: empleados, fichajes, vacaciones y su saldo, clientes,
   proveedores, viajes (tms), stock, facturas, **chóferes, flota y la documentación de ambos** (carnés, CAP, tarjeta de
   tacógrafo, ITV, seguros…). Lo que existe en Odoo se lee y se escribe en Odoo, sin copias que se editen.
2. **Movildata se consulta en directo** (posición, actividad, tacógrafo).
3. **Supabase guarda solo:**
   a) lo que no va a Odoo: login, perfiles, permisos, centros, enlace persona↔empleado de Odoo, ropa y EPIs,
      documentación que no esté en Odoo (la de chóferes y vehículos está en Odoo), incidencias, inspecciones y la cola
      de envíos a Odoo;
   b) el histórico: fotos periódicas de Odoo y Movildata que solo se añaden y nunca se editan, con fecha y origen. Si un
      dato está mal se corrige en Odoo y la siguiente foto lo recoge.
   **Antes de crear una tabla en Supabase, comprueba si el dato ya existe en Odoo.**
4. **Acceso a Odoo:**
   - Leer: se permite consultar cualquier modelo, solo con los métodos de lectura (`METODOS_LECTURA` de
     `servicios/odoo_client.py`: `search_read`, `read`, `read_group`, `search`, `search_count`, `name_search`,
     `fields_get`).
   - Escribir: solo la lista cerrada `ESCRITURAS` y los campos `EDITABLE_FIELDS` de `servicios/odoo_client.py`
     (abrir y cerrar asistencias, crear la solicitud de una ausencia aprobada, y nota y bultos/peso de DECA; DECA genera
     además el PDF de su orden con el informe `tms_reporting.tms_transportation_order`).
   - **Cómo se escribe** (detalle en `docs/odoo.md`): siempre desde un registro de Supabase que hace de cola, a través de
     su mapa de `servicios/sincronizacion.py`, con interruptor de modo prueba, sin reenviar nunca lo ya enviado y
     dejando a la vista el resultado o el error. Solo se crean registros nuevos o se completan los propios (cerrar la
     asistencia abierta, los campos de DECA); nunca se corrige desde la app lo que alguien ha hecho en Odoo.
   - ARGON (`servicios/argon/`) tiene su propia lista, **congelada tal como está** (`PERMITIDO` en
     `argon_escritor.py`: pedidos de venta y contenedores, solo en el Odoo de pruebas salvo `ARGON_PERMITIR_PRODUCCION=1`).
     Es la segunda y última lista autorizada.
   - Borrar (`unlink`): nunca.
   - Nunca ampliar las escrituras sin permiso expreso de Félix; cualquier escritura nueva se propone antes, explicando
     qué toca. `tests/test_odoo_escrituras.py` falla si una de las dos listas crece, si aparece un borrado o si otro
     archivo habla con Odoo por su cuenta: no se arregla la prueba, se pide permiso.
   - Leer todo no es enseñar todo: cada pantalla y cada ruta filtra por los permisos de quien mira (nóminas, salarios y
     contabilidad nunca a quien no corresponda). No hay rutas genéricas: ninguna acepta un modelo, un dominio o unos
     campos de Odoo como parámetro (lo vigila la misma prueba).
5. **Perfiles:** se configuran desde la app con los permisos de `src/lib/permisos.json`. Nunca hacer una página por
   perfil; una página por función, filtrada por permisos y centro.
6. **Fase actual: piloto de fichaje y vacaciones.** No añadir funciones nuevas; solo limpiar, arreglar y pulir. Lo demás
   queda oculto quitando el permiso en los perfiles, no borrando código.
   Excepción autorizada por Félix el 16-11-2026: la organización por grupos de trabajo (centros, zonas, departamentos y
   tipos de transporte; `docs/acceso-y-perfiles.md`).

## Stack
- Web: Next.js 16 (App Router, `src/`), TypeScript, CSS propio (`src/app/globals.css`, `src/app/shell.css`). Next 16 usa
  `src/proxy.ts` (antes «middleware»).
- Login y datos propios: Supabase (`@supabase/ssr`). Permisos en la base de datos con RLS (`supabase/migrations/`).
- API Python (FastAPI) en `servicios/`, publicada en Vercel con `api/index.py`: DECA, ARGON, fichajes y ausencias hacia
  Odoo, Movildata y finanzas de Odoo. Rutas `/api/deca|argon|rrhh|chofer|flota|odoo/*` (rewrites en `next.config.ts`).
- PWA de DECA: `public/deca/` (HTML/JS sin framework, funciona sin cobertura). Lleva la cabecera y el menú de la app
  (`public/deca/cabecera.css`, que también importa la web, y `cabecera.js`; `docs/deca.md`).

## Reglas
- Todo texto visible, en **español**, claro y no técnico. Botones grandes; pensado para móvil y cabina.
- **Secretos nunca en código ni en git** (`.env.local`). La clave secreta de Supabase solo en servidor
  (`src/lib/supabase/admin.ts` con `server-only`, y `servicios/supa.py` solo para anotar envíos a Odoo y la
  sincronización).
- Cambios de base de datos **solo con migraciones nuevas** en `supabase/migrations/` (nunca editar ni borrar una ya
  aplicada). Toda tabla nueva con RLS activado y sus políticas.
- **Permisos:** catálogo único en `src/lib/permisos.json`. Toda función nueva añade ahí sus permisos; páginas con
  `conPermiso(...)`, RLS con `privado.tengo_permiso` / `privado.puedo_sobre`, nunca roles fijos en el código.
- Toda ruta de API nueva exige sesión y permiso (`requiere_permiso` en Python). Un test comprueba que ninguna ruta queda
  abierta.
- Datos que deban llegar a Odoo: un mapa en `servicios/sincronizacion.py` (nunca envíos sueltos).
- Odoo: solo a través de `servicios/odoo_client.py` (y ARGON con su lista congelada). Nunca rutas genéricas.
  **`DRY_RUN=true` por defecto**; producción v15 solo con el pedido S2621473 y permiso expreso.
- Al cambiar `public/deca/*`, subir la versión de `CACHE` en `public/deca/sw.js`.
- **Preguntar antes de `git push`** (el push despliega en Vercel).

## Cambios que afectan a una integración con Odoo

Que Odoo no devuelva un error no demuestra que el dato esté bien. Estas normas se cumplen todas, sin excepción, y un
cambio que no las cumpla no se entrega.

**Cuándo se aplican:** al tocar `servicios/odoo_client.py`, `servicios/sincronizacion.py`, `servicios/rrhh.py`,
`servicios/argon/` o lo que DECA escribe; al cambiar una tabla o columna de Supabase de la que sale un envío (fichajes,
ausencias); al cambiar una variable `ODOO_*`, `DRY_RUN` o `RRHH_DRY_RUN`; y cuando cambia el propio Odoo (versión,
dirección, usuario técnico, aplicaciones instaladas, tipos de ausencia).

1. **Antes de tocar, decir qué alcanza:** qué dato, qué modelo y campos de Odoo, quién lo provoca y qué registros que
   ya existen podrían verse afectados.
2. **Nunca se estrena en producción.** Se prueba primero en el Odoo de pruebas (`ENV_FILE=.env.pruebas`). Si no hay
   Odoo de pruebas disponible, el cambio se para y se avisa a Félix.
3. **Se lee de vuelta lo escrito.** Por cada escritura afectada se envía un caso en pruebas, se vuelve a leer el
   registro en Odoo y se compara campo a campo con lo guardado en la app: empleado, empresa, fecha y hora (Odoo guarda
   en UTC; la app enseña la hora de Madrid), tipo de ausencia y días, mercancía, bultos, palets y peso.
4. **Casos mínimos por dato:**
   - Fichajes: entrada y salida; con pausa; una jornada que cruza la medianoche; una persona de cada empresa.
   - Ausencias: de un día y de varios; un tipo de cada clase que use la app.
   - DECA: un bulto con sus cuatro campos y la nota.
   - Siempre: enviar dos veces el mismo registro no lo duplica en Odoo.
5. **Las lecturas también se comprueban.** Si cambia un campo, un filtro o la empresa de una lectura, la cifra de la
   app se compara con la misma cifra en la pantalla de Odoo, al menos un caso por empresa.
6. **Pruebas automáticas:** `pytest` completo, `scripts.comprobar_compatibilidad` y `scripts.comprobar_permisos`
   contra el Odoo de pruebas. Un fallo no se arregla cambiando la prueba.
7. **Paso a producción, solo con permiso expreso de Félix para ese cambio.** Primero un único registro real; se lee de
   vuelta en Odoo y, si coincide, sale el resto. Los interruptores `DRY_RUN` y `RRHH_DRY_RUN` no se cambian sin ese
   permiso.
8. **La entrega dice qué se comprobó:** los casos probados, los ids de los registros de Odoo leídos de vuelta y lo que
   no se pudo comprobar. Lo que no se pudo comprobar se dice; nunca se da por bueno.
9. **Si un dato ha llegado mal:** se paran los envíos de ese dato (su interruptor a `true`), se avisa a Félix con la
   lista de registros afectados y se corrige en Odoo. Desde la app no se corrige ni se borra nada.

## Comprobar antes de entregar
```bash
.venv/bin/python -m pytest -q
npx tsc --noEmit && npx next build
.venv/bin/python -X utf8 -m scripts.prueba_navegador     # si se toca DECA
```

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
