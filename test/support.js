import assert from 'node:assert/strict';
import { createApp } from '../server.js';

export async function setup() {
  const { app, db } = createApp({ dbPath: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const client = () => {
    let cookie = '';
    let csrf = '';
    return async (path, method = 'GET', body, status = 200, csrfOverride) => {
      const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrfOverride ?? csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
      const data = await res.json();
      assert.equal(res.status, status, JSON.stringify(data));
      if (data.csrf) csrf = data.csrf;
      return data;
    };
  };
  const admin = client();
  const outside = client();
  const pass = 'Password123456';
  await admin('/register', 'POST', { company: 'Empresa Uno', code: 'empresa-uno', name: 'Administrador', email: 'admin@example.com', password: pass }, 201);
  await admin('/me');
  await outside('/register', 'POST', { company: 'Empresa Dos', code: 'empresa-dos', name: 'Otro administrador', email: 'admin@example.com', password: pass }, 201);
  await outside('/me');
  const member = async (name, role) => {
    const email = name + '@example.com';
    const result = await admin('/users', 'POST', { name, email, role }, 201);
    const invitation = await admin(`/users/${result.id}/invitation`, 'POST');
    const request = client();
    await request('/activate', 'POST', { token: new URL(invitation.url).searchParams.get('invitation'), password: pass });
    await request('/login', 'POST', { code: 'empresa-uno', email, password: pass });
    await request('/me');
    return { request, id: result.id };
  };
  const owner = await member('owner', 'Product Owner');
  const otherOwner = await member('other-owner', 'Product Owner');
  const developer = await member('developer', 'Developer');
  const master = await member('master', 'Scrum Master');
  const project = await owner.request('/projects', 'POST', { name: 'Portal', description: 'Portal de clientes' }, 201);
  const secondProject = await owner.request('/projects', 'POST', { name: 'Otro portal', description: 'Otro producto' }, 201);
  const story = { title: 'Registro de clientes', actor: 'vendedor', goal: 'registrar clientes', benefit: 'atender sus solicitudes', criteria: ['El nombre es obligatorio.', 'Los datos se guardan.'] };
  const stories = `/projects/${project.id}/stories`;
  return { db, admin, outside, owner: owner.request, otherOwner: otherOwner.request, developer: developer.request, master: master.request, project, secondProject, story, stories, close: async () => { await new Promise(resolve => server.close(resolve)); db.close(); } };
}
