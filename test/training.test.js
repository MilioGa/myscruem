import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import { createApp } from '../server.js';

test('Material de capacitación: guía, infografías y glosario con búsqueda para todos los roles', async () => {
  const f = await setup();
  try {
    for (const request of [f.admin, f.owner, f.master, f.developer, f.outside]) {
      const guide = await request('/training');
      assert.deepEqual(guide.modules.map(module => module.id), ['que-es-scrum', 'roles', 'eventos-artefactos', 'herramientas']);
      assert.ok(guide.modules.every(module => module.sections.length >= 3 && module.sections.every(section => section.title && section.body)));
      assert.equal(guide.infographics.length, 3);
      assert.ok(guide.terms >= 25);
    }
    const all = await f.developer('/training/glossary');
    assert.ok(all.length >= 25);
    assert.ok(all.every(item => item.term && item.definition && item.example));
    const find = async q => (await f.owner(`/training/glossary?q=${encodeURIComponent(q)}`)).map(item => item.term);
    assert.ok((await find('sprint')).includes('Sprint Backlog'));
    assert.deepEqual(await find('EPICA'), ['Épica']);
    assert.ok((await find('impedimento')).includes('Impedimento'));
    assert.deepEqual(await find('término inexistente xyz'), []);
  } finally { await f.close(); }
});

test('Las infografías se sirven como imágenes y la guía requiere sesión', async () => {
  const { app, db } = createApp({ dbPath: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/training`)).status, 401);
    assert.equal((await fetch(`${base}/api/training/glossary?q=sprint`)).status, 401);
    for (const name of ['ciclo-sprint', 'tablero-kanban', 'burndown']) {
      const response = await fetch(`${base}/capacitacion/${name}.svg`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
      assert.match(await response.text(), /<title id="t">/);
    }
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});
