# Automatizaciones

Sección de la app (`/automatizaciones`) con herramientas que hacen solas un trabajo repetitivo. La portada enseña una
tarjeta por cada automatización que la persona tiene permitida; quien no tiene ninguna no ve la sección.

No usa base de datos: la lista de automatizaciones está en el código (`src/lib/automatizaciones.ts`) y cada una se da o
se quita con su permiso en **Administración → Perfiles**.

## Añadir una automatización

1. Su entrada en `src/lib/automatizaciones.ts` (id, nombre, descripción, ruta, permiso, icono y rótulo).
2. Su permiso (`automatizaciones.<id>`) en el área `automatizaciones` de `src/lib/permisos.json`. Una prueba
   (`tests/web/gasoleo.test.mjs`) falla si una entrada del catálogo no tiene su permiso ahí.
3. Su página en `src/app/automatizaciones/<id>/page.tsx`, protegida con `conPermiso("automatizaciones.<id>")`.
4. Si necesita la API Python: rutas `/api/automatizaciones/...` con `requiere_permiso("automatizaciones.<id>")`
   (el *rewrite* de `next.config.ts` y la exclusión de `src/proxy.ts` ya cubren todo `/api/automatizaciones/`).
5. Marcar el permiso en los perfiles que la deban ver.

## Revisión del precio del transporte por gasóleo

`/automatizaciones/gasoleo`, permiso `automatizaciones.gasoleo` (pensada para tráfico). Calcula la revisión obligatoria
del precio de un transporte por la variación del gasóleo (Ley 15/2009, art. 38; Orden FOM/1882/2012, condición 3.4, con
los RD-ley 9/2026 y 18/2026). Es la calculadora que estaba en GitHub (Revision-Gasoleo), reescrita dentro de la app con
las mismas fórmulas y textos; el selector de idioma, la instalación como app aparte y la pantalla de carga no se han
traído. Lo último que se escribe se recuerda en ese navegador.

- **Cálculo** (`src/lib/gasoleo.ts`): funciones puras, sin pantalla. No se cambia una fórmula sin pasar
  `scripts/comprobar_gasoleo.mjs`, que compara con la original (ver abajo).
- **Pantalla**: `src/app/automatizaciones/gasoleo/` (`page.tsx` en el servidor, `Calculadora.tsx` en el navegador y
  `compartir.ts` para la imagen de «Compartir resultado»).
- **Datos** (`servicios/gasoleo.py`, ruta `GET /api/automatizaciones/gasoleo/precios`): la API abre la
  [página del Ministerio](https://www.transportes.gob.es/transporte-terrestre/servicios-al-transportista/indice-de-variacion-semanal-de-los-precios-medios-del-gasoleo-en-espana),
  busca el enlace a la Excel semanal y la lee (hojas `PRECIOS_DEL_GASOLEO` y `PRECIOS DE REFERENCIA`). Devuelve el mismo
  formato que el antiguo `data.json`: `fileDate` (fecha de la Excel, sacada de su nombre), `source`, `checkedAt` y `rows`
  (`[serial de Excel, PVP, PVP sin IVA, impuesto, PAI, devolución GP, Pmed ≥ 7,5 t, Pmed < 7,5 t]`, desde 2018).
  Solo descarga de direcciones `https://…gob.es`. No toca Odoo ni Supabase.
- **Copia en memoria**: la Excel descargada se guarda 2 horas en la memoria del proceso; en ese tiempo nadie espera al
  Ministerio. En Vercel cada instancia tiene su copia y la pierde al apagarse: la primera visita después descarga otra vez
  (menos de un segundo en las pruebas). La descarga entera (página, redirecciones y Excel) tiene un plazo de 15 s: la
  Excel solo usa el tiempo que deje la página y, si se pasa, se corta y cuenta como fallo del Ministerio. Cada espera
  dentro de ese plazo es de 8 s como mucho (5 s para conectar); si el Ministerio se queda callado justo al final, el
  corte llega como muy tarde a los 23 s. La página espera 28 s y la función de Vercel tiene 30 s.
- **Una descarga a la vez**: si otra visita ya está descargando, se espera a que termine (como mucho 24 s) y se usa lo
  que haya conseguido; si aun así no ha terminado, se enseña la última copia con un aviso o, sin copia, el mensaje de
  abajo.
- **Si el Ministerio falla**: se enseña la última copia buena con el aviso «El Ministerio no responde ahora mismo…» y se
  reintenta pasados 10 minutos. Si no hay ninguna copia, ese fallo se recuerda 1 minuto (en ese tiempo no se vuelve a
  llamar al Ministerio) y la página dice que no hay precios y enlaza la
  [calculadora oficial del Ministerio](https://apps.fomento.gob.es/preciogasoleo/angular_proyecto/client/gasoleoCambio).
- **Retraso**: si la última semana con precio tiene más de 17 días, la página avisa de que debería haber datos más
  recientes (el Ministerio publica cada semana).

### Comprobaciones

```bash
.venv/bin/python -m pytest -q tests/test_gasoleo.py                       # Excel, enlace, fecha, copia, fallos y permisos
node --experimental-strip-types --test tests/web/gasoleo.test.mjs          # resultados de la original en casos fijos
node --experimental-strip-types scripts/comprobar_gasoleo.mjs <index.html> <data.json>
```

`comprobar_gasoleo.mjs` necesita el `index.html` y un `data.json` de la calculadora original (repositorio
Revision-Gasoleo). Ejecuta la lógica original sin navegador y la compara con la nueva en unas 18.500 combinaciones
(precios reales y dos series inventadas que tocan cada tramo de C, los redondeos «del 5» y el mes incompleto): números,
textos, gráfica y tabla de semanas. Debe acabar con «diferencias: 0».
