import { createApp } from '../server.js';

const password = process.env.DEMO_PASSWORD || 'Demostracion2026';
const { app, db } = createApp();
if (db.prepare("SELECT id FROM companies WHERE code='empresa-demo'").get()) {
  console.log('La empresa de demostración ya existe. Código: empresa-demo');
  process.exit(0);
}
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
const client = () => {
  let cookie = '';
  let csrf = '';
  return async (path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const data = await response.json();
    if (!response.ok) throw new Error(`${path}: ${data.error}`);
    if (data.csrf) csrf = data.csrf;
    return data;
  };
};
try {
  const admin = client();
  await admin('/register', 'POST', { company: 'Empresa Demo', code: 'empresa-demo', name: 'Laura Administradora', email: 'admin@demo.test', password });
  await admin('/me');
  const member = async (name, email, role) => {
    const user = await admin('/users', 'POST', { name, email, role });
    const invitation = await admin(`/users/${user.id}/invitation`, 'POST');
    const request = client();
    await request('/activate', 'POST', { token: new URL(invitation.url).searchParams.get('invitation'), password });
    await request('/login', 'POST', { code: 'empresa-demo', email, password });
    await request('/me');
    return { request, id: user.id };
  };
  const owner = await member('Paula Owner', 'po@demo.test', 'Product Owner');
  const developer = await member('Diego Developer', 'dev@demo.test', 'Developer');
  const second = await member('Daniela Developer', 'dev2@demo.test', 'Developer');
  const master = await member('Sergio Master', 'sm@demo.test', 'Scrum Master');
  const project = await owner.request('/projects', 'POST', { name: 'Portal de clientes', description: 'Proyecto de demostración del tablero Kanban y el gráfico Burndown.' });
  const stories = [['Registro de clientes', 5], ['Consulta de pedidos', 3], ['Reporte de ventas', 8], ['Perfil del cliente', 2]];
  const ids = [];
  for (const [title, points] of stories) {
    const story = await owner.request(`/projects/${project.id}/stories`, 'POST', { title, actor: 'cliente', goal: title.toLowerCase(), benefit: 'mejorar la atención', criteria: ['Los datos se guardan correctamente.'] });
    await developer.request(`/projects/${project.id}/stories/${story.id}/estimate`, 'PATCH', { points });
    ids.push(story.id);
  }
  const today = new Date();
  const date = offset => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset).toLocaleDateString('en-CA');
  const sprint = await master.request(`/projects/${project.id}/sprints`, 'POST', { name: 'Sprint 3', startDate: date(0), endDate: date(6), goal: 'Tablero Kanban y gráfico Burndown operativos.' });
  for (const id of ids.slice(0, 3)) await developer.request(`/projects/${project.id}/sprints/${sprint.id}/stories`, 'POST', { storyId: id });
  await master.request(`/projects/${project.id}/sprints/${sprint.id}/start`, 'POST');
  const tasks = [[ids[0], 'Formulario de registro', developer, 'Terminado'], [ids[0], 'Pruebas de registro', second, 'Terminado'], [ids[1], 'Listado de pedidos', developer, 'En curso'], [ids[1], 'Filtro por estado', second, 'En revisión'], [ids[2], 'Consulta de ventas', developer, 'Por hacer'], [ids[2], 'Gráfica mensual', second, 'Por hacer']];
  for (const [storyId, title, person, status] of tasks) {
    const task = await developer.request(`/projects/${project.id}/tasks`, 'POST', { title, storyId, assigneeId: person.id });
    if (status !== 'Por hacer') await developer.request(`/projects/${project.id}/tasks/${task.id}/status`, 'PATCH', { status });
  }
  console.log(`Datos de demostración creados. Código: empresa-demo · Contraseña: ${password}`);
  console.log('Usuarios: admin@demo.test, po@demo.test, sm@demo.test, dev@demo.test, dev2@demo.test');
} finally {
  await new Promise(resolve => server.close(resolve));
  db.close();
}
