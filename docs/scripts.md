# Scripts (`scripts/`)

Se lanzan desde la carpeta del proyecto con el entorno de Python: `.venv/bin/python -X utf8 -m scripts.<nombre>`
(Windows: `.\.venv\Scripts\python.exe -X utf8 -m scripts.<nombre>`). Ninguno escribe en Odoo.

## Comprobaciones y diagnóstico (solo lectura)

| Script | Para qué | Cuándo |
|---|---|---|
| `prueba_navegador` | Prueba de DECA de principio a fin en un navegador real, con una cámara simulada que lee un QR. Arranca la web y la API sin Supabase. | Cada vez que se toque DECA (`AGENTS.md`). |
| `comprobar_permisos` | Comprueba qué puede y qué no puede hacer el usuario técnico de Odoo del entorno, sin escribir nada. | Al cambiar de usuario técnico o al pasar a Odoo real. |
| `diagnostico` | Abre un pedido (p. ej. `S2621473`) como lo haría DECA, enseña lo que encuentra y lista los campos de etapa y estado de tareas y bultos. Necesita `ODOO_MODE=real`. | Para averiguar por qué un pedido no carga en DECA. |
| `diagnostico_movildata` | La forma de cada respuesta de Movildata (tipo, cuántos y nombres de campos) y si la app la sabe leer. No enseña datos ni la clave. | Si Movildata cambia su formato o la flota sale vacía. |
| `comprobar_compatibilidad` | Comprueba, solo leyendo, si la app funcionaría con otra versión de Odoo (p. ej. la 18). Usa `ENV_FILE` para apuntar al entorno a probar. | Antes de actualizar Odoo. |

`comprobar_compatibilidad` revisa también los campos habituales que usa el envío de fichajes y ausencias en
`hr.employee`, `hr.attendance`, `hr.leave` y `hr.leave.type`. Consulta su definición (`fields_get`), sin leer fichas
personales ni crear registros de RRHH. Si falta un campo o no se puede consultar un modelo, lo indica como fallo y
continúa con los demás. No comprueba el campo de correo adicional de `ODOO_CAMPO_CORREO`, si está configurado.
Esto no demuestra que Odoo acepte una entrada o una ausencia: todavía hay que probar el envío en el Odoo de pruebas,
con el empleado, saldo y permisos adecuados.

Para ejecutarlo en Mac con el archivo del entorno de pruebas preparado:

```bash
ENV_FILE=.env.pruebas .venv/bin/python -X utf8 -m scripts.comprobar_compatibilidad
```

Ese archivo debe configurar `ODOO_MODE=real` y las credenciales del Odoo de pruebas. No cambies el entorno de
producción. Sin `ENV_FILE`, la configuración intenta cargar `.env` y `.env.local`.

## Generadores (solo se usan al cambiar diseño o textos de DECA)

| Script | Qué genera |
|---|---|
| `generar_guia` | `public/deca/guia.html` a partir de `GUIA_CONDUCTORES.md`. Un test falla si la guía se queda desfasada. |
| `crear_iconos` | Iconos de la app (acceso directo del móvil y pestaña). |
| `crear_imagen_compartir` | Imagen de vista previa al compartir el enlace (WhatsApp, Teams…). Necesita la fuente Segoe UI de Windows. |
| `preparar_logos` | Logos de Trimodos, STINSA y TRANSARGI recortados para la web. |

> **Desfasados:** `crear_iconos`, `crear_imagen_compartir` y `preparar_logos` todavía escriben en `public/icons` y
> `public/img`, de cuando DECA estaba en la raíz de `public/`. Los archivos de verdad están en `public/deca/icons` y
> `public/deca/img`. Antes de volver a usarlos hay que corregir esas rutas (es código de DECA: con permiso).
