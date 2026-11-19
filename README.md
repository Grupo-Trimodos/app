<p align="center">
  <img src="public/deca/img/trimodos.png" alt="Grupo Trimodos" width="320">
</p>

<h1 align="center">App interna · Grupo Trimodos</h1>

<p align="center">
  Una aplicación para oficina, móvil y cabina.<br>
  Fichaje, vacaciones y organización del equipo, con Odoo como fuente principal de datos.
</p>

<p align="center">
  <a href="#puesta-en-marcha">Puesta en marcha</a> ·
  <a href="docs/README.md">Documentación</a> ·
  <a href="CONTRIBUTING.md">Contribuir</a> ·
  <a href="AGENTS.md">Reglas del proyecto</a>
</p>

## Estado del proyecto

**Piloto de fichaje y vacaciones**, con organización por grupos de trabajo autorizada.
Las demás funciones se conservan en el código y su disponibilidad se controla mediante permisos.
Durante esta fase se priorizan las correcciones, la limpieza y el pulido de la experiencia.

La interfaz está en español y se adapta a ordenador y móvil. DECA dispone de una PWA para trabajar sin cobertura.

## Arquitectura

| Componente | Tecnología | Responsabilidad |
|---|---|---|
| Web | Next.js 16 · React 19 · TypeScript | Pantallas, sesión y navegación |
| API | FastAPI · Python | Integraciones y operaciones del servidor |
| Datos principales | Odoo 18 | Empleados, fichajes, ausencias, transporte, flota y documentación asociada |
| Datos propios | Supabase · PostgreSQL · RLS | Login, perfiles, permisos, datos propios de la app y cola de envíos |
| Telemetría | Movildata | Consulta en directo de posición, actividad y tacógrafo |
| Publicación | Vercel | Web y API Python en un único proyecto |

**Odoo manda en los datos actuales.** La app no mantiene copias editables de lo que ya existe en Odoo.
Los envíos pasan por una cola y por las listas de escritura autorizadas; los detalles y la excepción de ARGON
están en [las reglas del proyecto](AGENTS.md) y en [la integración con Odoo](docs/odoo.md).
Cada pantalla y cada ruta aplican los permisos de la persona conectada.

## Puesta en marcha

### Requisitos

- Node.js 22 y npm.
- Python 3.12 o superior.
- Un proyecto Supabase configurado para usar el login y las funciones de la app.

Ejecuta los comandos desde la raíz del repositorio.

### 1. Instalar dependencias

```bash
npm ci
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
```

En Windows (PowerShell):

```powershell
npm ci
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
```

### 2. Preparar el entorno

Copia [`.env.example`](.env.example) a `.env.local` y completa las variables necesarias.
Si ya existe `.env.local`, conserva su contenido. Este archivo es privado y no se sube a Git.

La plantilla configura Odoo en modo simulado (`ODOO_MODE=mock`) y mantiene
`DRY_RUN=true` y `RRHH_DRY_RUN=true`. Para simular también Movildata, configura
`MOVILDATA_MODE=mock` en tu entorno local: la plantilla lo declara como `real`.

Sin las variables de Supabase puedes probar DECA con datos simulados; el resto de la app necesita sesión.
La configuración de Supabase, proveedores de acceso y Vercel se explica en
[configuración inicial](docs/configuracion-inicial.md).

### 3. Arrancar la aplicación

Con el entorno de Python activado:

```bash
npm run dev
```

| Servicio | Dirección local |
|---|---|
| Aplicación | <http://localhost:3000> |
| DECA | <http://localhost:3000/deca/> |
| API Python | <http://localhost:8000> |

El comando arranca la web y la API juntas. También se pueden iniciar por separado con
`npm run dev:web` y `npm run dev:api`.

## Estructura del repositorio

```text
.github/               Plantilla de pull request
api/                   Entrada de la API Python en Vercel
src/                   Aplicación Next.js y utilidades compartidas
servicios/             API FastAPI e integraciones con Odoo y Movildata
public/deca/           PWA, recursos de marca y guía generada de DECA
supabase/migrations/   Historial de cambios de base de datos y políticas RLS
tests/                 Pruebas Python y web
scripts/               Diagnósticos, comprobaciones y generadores
docs/                  Documentación funcional, técnica y notas históricas
```

[`GUIA_CONDUCTORES.md`](GUIA_CONDUCTORES.md) es la fuente de la guía que se genera dentro de DECA.
[`AGENTS.md`](AGENTS.md) contiene las reglas comunes para personas y agentes; `CLAUDE.md` remite a ellas.

## Comprobaciones

Con el entorno de Python activado:

```bash
python -m pytest -q
npm run test:jornada
npm run typecheck
npm run build
```

`test:jornada` ejecuta todas las pruebas de `tests/web/`, incluidas las de calendario, perfiles y gasóleo.
Las pruebas Python no cargan `.env.local`.

Si se modifica DECA, ejecuta además la prueba de navegador:

```bash
python -m playwright install chromium
python -X utf8 -m scripts.prueba_navegador
```

Los cambios en integraciones con Odoo requieren también los casos y las lecturas de vuelta en el entorno de
pruebas descritos en [AGENTS.md](AGENTS.md). Las pruebas automáticas no sustituyen esa comprobación.

## Documentación

- [Índice completo](docs/README.md): documentación agrupada por tema.
- [Fichaje y vacaciones](docs/fichaje-y-vacaciones.md): funcionamiento del piloto.
- [Acceso y perfiles](docs/acceso-y-perfiles.md): permisos y organización.
- [Odoo](docs/odoo.md): lecturas, cola de envíos y límites de escritura.
- [Identidad visual](docs/identidad-visual.md): logos, tipografía y colores.
- [Scripts](docs/scripts.md): utilidades y cuándo ejecutarlas.
- [Guía de contribución](CONTRIBUTING.md): preparación y revisión de cambios.

## Despliegue

La web y la API se publican juntas en [la aplicación de Grupo Trimodos](https://app-two-omega-92.vercel.app).
Un push a `main` despliega en Vercel: **requiere autorización previa de Félix**.
Consulta [configuración inicial](docs/configuracion-inicial.md) para los ajustes del servicio.
