# DECA: reglas y lecciones (no redescubrir)

- **Lista blanca en el cliente de Odoo** (`servicios/odoo_client.py`): solo se escriben `goods_id`, `number_of_packages`, `euro_pallet_qty` y `shipping_weight` de `tms.package`; nota solo en `project.task`; imprimir solo la orden de transporte. Hay tests que lo garantizan.
- **`DRY_RUN=true`** hace todo menos escribir/publicar/imprimir. Producción v15 solo con el pedido de prueba S2621473 y con permiso expreso.
- Editable solo en etapa «Nuevo» o «En desarrollo» (`EDITABLE_STAGES`); aviso de peso por MMA a partir de `PESO_AVISO_KG` (27.000).
- **Imprimir exige sesión web**: una clave API no sirve; hace falta `ODOO_WEB_PASSWORD` y el usuario técnico **sin 2FA**. El informe lee vehículos: el usuario técnico necesita *Fleet / Administrator* (o que Tecnativa lo lea con `sudo`).
- Odoo 18: `message_post` necesita `body_is_html=True` (la app lo envía solo en ≥ 18).
- Al cambiar archivos de `public/deca/`, **sube la versión de caché** en `public/deca/sw.js`.
- La guía de conductores se edita en `GUIA_CONDUCTORES.md` y se genera con `python -X utf8 -m scripts.generar_guia` (un test falla si se queda desfasada).

## DECA dentro de la app (16-11-2026)

DECA sigue siendo una PWA aparte (`public/deca/`, abre sin cobertura), pero se ve y se usa como una pantalla más:

- **Misma cabecera y menú.** `public/deca/cabecera.js` pinta el marcado de `src/app/Cabecera.tsx` con los datos de
  `/api/sesion/cabecera` (nombre, menú de esa persona, pendientes e iconos; exige sesión). Chóferes y operarios ven la
  barra con «Inicio»; oficina y dirección, el menú lateral con «Órdenes de transporte» marcado. Los datos se guardan
  en el móvil: la siguiente vez sale al instante, y sin cobertura sale la última cabecera.
- **Misma hoja de estilos para la cabecera:** `public/deca/cabecera.css`. La importa `src/app/layout.tsx` y la enlaza
  DECA, así no hay dos copias. Si cambias el marcado en `Cabecera.tsx`, cámbialo en `cabecera.js`.
- **Menú, nombres e iconos** salen de `src/lib/navegacion.ts` (lo usan `Navegacion.tsx` y `/api/sesion/cabecera`).
- **Lo propio de DECA** está en `public/deca/styles.css`: mismos colores, letra y radios que la app, con botones y
  campos más altos (cabina y guantes) y modo de noche. El logo de la empresa de la orden acompaña al título y su color
  marca una raya bajo la cabecera mientras se edita o se revisa.
- Ya no tiene barra propia ni botón «Volver al inicio»: se vuelve con la cabecera, como en el resto.

## Abrir una orden desde «Mis viajes» (17-11-2026)

`/deca/?pedido=S2621473&empresa=stinsa` (o `transargi`) hace lo mismo que elegir la empresa y escribir el pedido: busca
con `/api/deca/resolve-qr` y los mismos permisos, y limpia la dirección para no repetir la búsqueda al recargar. Datos no
válidos: no busca nada. **DECA abre la orden más reciente del pedido**, y un pedido puede tener varias (17-11-2026: 16 de
las 50 órdenes abiertas de la ventana). Por eso «Mis viajes» solo ofrece el enlace cuando DECA abriría justo esa orden
(`OdooClient.tareas_que_abre_deca`); si no, pide escanear el QR de la orden. Abrir DECA por el id de la orden exigiría
cambiar `resolve` (DECA escribe en Odoo): queda propuesto, sin hacer. Detalle en [viajes.md](viajes.md).

## El PDF sin contraseña de un usuario de Odoo (pendiente de decidir)

Comprobado el 16-11-2026 en el Odoo 18 de producción, solo leyendo:

- Odoo **rechaza la clave API** para abrir una sesión web, y el informe (`/report/pdf/...`) solo se sirve con sesión
  web. Por RPC no hay ningún método público que genere el informe.
- El informe no es solo un PDF: al generarlo, Odoo crea el adjunto en la tarea, guarda su huella y fecha y pone en la
  hoja un QR que apunta a ese adjunto. Un PDF hecho en la app no tendría ese adjunto ni ese QR.
- Vías para dejar de necesitar `ODOO_WEB_PASSWORD`:
  1. **Una acción de servidor en Odoo** sobre «Tarea» que genere la orden (tres líneas, la crea Tecnativa o un
     administrador). La app la lanzaría con la clave API: una llamada nueva en `ESCRITURAS`
     (`ir.actions.server` · `run`, solo esa acción), con permiso expreso de Félix.
  2. **Un método público en `tms_reporting`** (cambio de Tecnativa) que haga lo mismo.
  3. Seguir como hoy, pero con un usuario técnico propio (su contraseña, sin doble factor), no la de una persona.

