import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function acciones(puede, guardar) {
  const fuente = readFileSync(new URL('../../src/app/admin/acciones.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const deps = {
    'next/cache': { revalidatePath() {} },
    '@/lib/volver': { volverA: () => null },
    '@/lib/supabase/admin': {},
    '@/lib/permisos': { esPermiso: p => ['fichaje.fichar', 'documentos.propios'].includes(p) },
    '@/lib/seguridad': { DOCUMENTOS_PERSONA: { cap: 'CAP' } },
    '@/lib/pin': {},
    '@/lib/usuario': { usuarioActual: async () => ({ perfil: { activo: true }, puede,
      supabase: { from: tabla => { assert.equal(tabla, 'perfiles'); return { update: datos => ({ eq: async () => { guardar(datos); return { error: null }; } }) }; } } }) },
  };
  const modulo = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(n => {
    if (!(n in deps)) throw Error(n);
    return deps[n];
  }, modulo, modulo.exports);
  return modulo.exports;
}
function formulario() {
  const f = new FormData(); f.set('id', '1'); f.set('nombre', 'Puesto');
  f.append('permisos', 'fichaje.fichar'); f.append('documentos', 'cap');
  return f;
}
test('guardar documentación requerida no vuelve a conceder un permiso desmarcado', async () => {
  let guardado;
  await acciones(p => p === 'admin.usuarios', d => { guardado = d; }).guardarPerfil(formulario());
  assert.deepEqual(guardado.permisos, ['fichaje.fichar']);
  assert.deepEqual(guardado.documentos, ['cap']);
});
test('un responsable sin administración no puede cambiar permisos', async () => {
  let guardado = false;
  await assert.rejects(acciones(() => false, () => { guardado = true; }).guardarPerfil(formulario()), /No tienes permiso/);
  assert.equal(guardado, false);
});
