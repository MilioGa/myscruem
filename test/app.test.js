import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

test('Cuentas, empresas, proyectos e historias de usuario', async () => {
  const { app, db } = createApp({ dbPath: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const client = () => {
    let cookie = '';
    let csrf = '';
    return async (path, method = 'GET', body, expected = 200, overrideCsrf) => {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': overrideCsrf ?? csrf }, body: body ? JSON.stringify(body) : undefined });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const result = await response.json();
      assert.equal(response.status, expected, JSON.stringify(result));
      if (result.csrf) csrf = result.csrf;
      return result;
    };
  };
  try {
    const admin = client();
    const outsider = client();
    const po = client();
    const developer = client();
    const pass = 'Contraseña-12345';
    await admin('/register', 'POST', { company: 'Empresa A', code: 'empresa-a', name: 'Admin A', email: 'admin@example.com', password: pass }, 201);
    await admin('/me');
    await outsider('/register', 'POST', { company: 'Empresa B', code: 'empresa-b', name: 'Admin B', email: 'admin@example.com', password: pass }, 201);
    await outsider('/me');
    const owner = await admin('/users', 'POST', { name: 'Owner', email: 'owner@example.com', role: 'Product Owner' }, 201);
    await po('/login', 'POST', { code: 'empresa-a', email: 'owner@example.com', password: pass }, 401);
    const firstInvite = await admin(`/users/${owner.id}/invitation`, 'POST');
    const secondInvite = await admin(`/users/${owner.id}/invitation`, 'POST');
    await po('/activate', 'POST', { token: new URL(firstInvite.url).searchParams.get('invitation'), password: pass }, 400);
    const token = new URL(secondInvite.url).searchParams.get('invitation');
    await po('/activate', 'POST', { token, password: pass });
    await po('/activate', 'POST', { token, password: pass }, 400);
    await po('/login', 'POST', { code: 'empresa-a', email: 'owner@example.com', password: pass });
    await po('/me');
    await po('/users', 'GET', undefined, 403);
    await po('/projects', 'POST', { name: 'Proyecto', description: 'Descripción' }, 403, 'invalid');
    const project = await po('/projects', 'POST', { name: 'Proyecto', description: 'Descripción' }, 201);
    assert.equal((await outsider('/projects')).length, 0);
    await outsider(`/projects/${project.id}/owner`, 'PATCH', { ownerId: owner.id }, 404);
    assert.equal((await po('/projects')).length, 1);
    await admin('/projects', 'POST', { name: 'No permitido', description: 'Prueba' }, 403);
    await admin(`/users/${owner.id}`, 'PATCH', { name: 'Owner', email: 'owner@example.com', role: 'Product Owner', status: 'Inactivo' }, 400);
    const dev = await admin('/users', 'POST', { name: 'Developer', email: 'dev@example.com', role: 'Developer' }, 201);
    const invitation = await admin(`/users/${dev.id}/invitation`, 'POST');
    await developer('/activate', 'POST', { token: new URL(invitation.url).searchParams.get('invitation'), password: pass });
    await developer('/login', 'POST', { code: 'empresa-a', email: 'dev@example.com', password: pass });
    await developer('/me');
    await developer('/projects', 'POST', { name: 'No', description: 'No' }, 403);
    await developer(`/projects/${project.id}`, 'PATCH', { name: 'Cambio', description: 'Cambio', archived: true }, 403);
    const story = { title: 'Registro de clientes', actor: 'vendedor', goal: 'registrar clientes', benefit: 'dar seguimiento a sus solicitudes', criteria: ['El nombre es obligatorio.', 'Los datos se conservan al consultar.'] };
    const storiesPath = `/projects/${project.id}/stories`;
    await admin(storiesPath, 'POST', story, 403);
    await developer(storiesPath, 'POST', story, 403);
    await outsider(storiesPath, 'GET', undefined, 404);
    await outsider(storiesPath, 'POST', story, 404);
    await po(storiesPath, 'POST', story, 403, 'invalid');
    for (const invalid of [{ title: ' ' }, { actor: '' }, { goal: '' }, { benefit: '' }, { criteria: [] }, { criteria: [' '] }, { criteria: 'Criterio' }, { criteria: Array(21).fill('Criterio') }]) {
      await po(storiesPath, 'POST', { ...story, ...invalid }, 400);
    }
    assert.deepEqual(await po(storiesPath), []);
    const firstStory = await po(storiesPath, 'POST', story, 201);
    const secondStory = await po(storiesPath, 'POST', { ...story, title: '<script>alert(1)</script>' }, 201);
    const savedStories = await developer(storiesPath);
    assert.deepEqual(savedStories.map(item => item.id), [firstStory.id, secondStory.id]);
    assert.deepEqual(savedStories[0].criteria, story.criteria);
    assert.equal(savedStories[0].actor, story.actor);
    assert.equal(savedStories[0].goal, story.goal);
    assert.equal(savedStories[0].benefit, story.benefit);
    const anotherProject = await po('/projects', 'POST', { name: 'Segundo proyecto', description: 'Otro producto' }, 201);
    assert.deepEqual(await po(`/projects/${anotherProject.id}/stories`), []);
    await po(`/projects/${anotherProject.id}`, 'PATCH', { name: 'Segundo proyecto', description: 'Otro producto', archived: true });
    await po(`/projects/${project.id}`, 'PATCH', { name: 'Editado', description: 'Descripción editada', archived: true });
    await po(storiesPath, 'POST', story, 400);
    assert.equal((await po(storiesPath)).length, 2);
    assert.equal((await po('/projects'))[0].archived, 1);
    await admin(`/users/${owner.id}`, 'PATCH', { name: 'Owner', email: 'owner@example.com', role: 'Product Owner', status: 'Inactivo' });
    await po('/me', 'GET', undefined, 401);
    await po('/login', 'POST', { code: 'empresa-a', email: 'owner@example.com', password: pass }, 401);
    assert.equal((await admin('/projects')).find(item => item.id === project.id).name, 'Editado');
    await admin(`/users/${dev.id}`, 'PATCH', { name: 'Developer editado', email: 'dev@example.com', role: 'Scrum Master', status: 'Activo' });
    await developer('/me', 'GET', undefined, 401);
    await outsider('/logout', 'POST');
    await outsider('/me', 'GET', undefined, 401);
    db.prepare('UPDATE sessions SET expires=0').run();
    await admin('/me', 'GET', undefined, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
