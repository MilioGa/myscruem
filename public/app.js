const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const notice = document.querySelector('#notice');
let state = { page: 'projects', filter: 'active', query: '', projects: [], users: [], owners: [] };
let timer;
let boardTimer;
let notificationTimer;
let closeNotificationsBound = false;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const flash = message => {
  notice.textContent = message;
  notice.classList.add('visible');
  clearTimeout(timer);
  timer = setTimeout(() => notice.classList.remove('visible'), 6000);
};
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && state.user) { state.user = null; modal.close(); authView(); }
    throw new Error(result.error);
  }
  return result;
}
const field = (label, name, type = 'text', value = '', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" required ${extra}></label>`;
const roleOptions = selected => ['Administrador', 'Product Owner', 'Scrum Master', 'Developer'].map(role => `<option ${role === selected ? 'selected' : ''}>${role}</option>`).join('');
const badge = (text, kind = '') => `<span class="badge ${kind}">${escape(text)}</span>`;
function authView(mode = 'login') {
  const token = new URLSearchParams(location.search).get('invitation');
  if (token) mode = 'activate';
  app.innerHTML = `<main class="auth"><aside class="intro"><img src="/logo.png" alt="Logo de MySCruEm"><div><span class="eyebrow">UN ESPACIO PARA TU EQUIPO</span><h1>MySCruEm<span>.</span></h1><p>Grandes proyectos.<br>Un comienzo organizado.</p></div><small>Tu empresa, tu equipo, tus proyectos.</small></aside><section class="auth-panel"><div class="auth-form"><span class="eyebrow">BIENVENIDO A MY SCRUEM</span><h2>${mode === 'register' ? 'Registra tu empresa' : mode === 'activate' ? 'Activa tu cuenta' : 'Inicio de sesión'}</h2><p class="muted">${mode === 'register' ? 'Crea tu espacio de trabajo y tu cuenta de administrador.' : mode === 'activate' ? 'Elige una contraseña para empezar a trabajar con tu equipo.' : 'Accede al espacio de trabajo de tu empresa.'}</p><form id="auth-form">
  ${mode === 'register' ? field('Nombre de la empresa', 'company', 'text', '', 'maxlength="120"') + field('Tu nombre', 'name', 'text', '', 'autocomplete="name" maxlength="120"') : ''}
  ${mode !== 'activate' ? field('Código de empresa', 'code', 'text', '', 'placeholder="mi-empresa" pattern="[a-z0-9-]{3,40}" maxlength="40" autocomplete="organization"') + field('Correo electrónico', 'email', 'email', '', 'autocomplete="username" maxlength="254"') : ''}
  ${field('Contraseña', 'password', 'password', '', `autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="${mode === 'login' ? 1 : 10}" maxlength="128"`)}
  ${mode !== 'login' ? '<small class="muted">Usa al menos 10 caracteres.</small>' : ''}
  <p class="form-error" role="alert"></p><button class="primary" type="submit">${mode === 'register' ? 'Crear empresa' : mode === 'activate' ? 'Activar cuenta' : 'Acceder'} <span>→</span></button></form><p class="switch">${mode === 'login' ? '¿Tu empresa es nueva? <button data-auth="register">Registrar empresa</button>' : '<button data-auth="login">Volver al inicio de sesión</button>'}</p></div></section></main>`;
  app.querySelector('[data-auth]').onclick = event => { history.replaceState({}, '', '/'); authView(event.target.dataset.auth); };
  bindForm(document.querySelector('#auth-form'), async data => {
    await api(mode === 'register' ? '/register' : mode === 'activate' ? '/activate' : '/login', 'POST', { ...data, token });
    if (mode === 'activate') { history.replaceState({}, '', '/'); authView(); flash('Cuenta activada. Ya puedes iniciar sesión.'); }
    else await load();
  });
}
function bindForm(form, handler) {
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    form.querySelector('.form-error').textContent = '';
    try { await handler(Object.fromEntries(new FormData(form))); }
    catch (error) { form.querySelector('.form-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
}
async function load() {
  Object.assign(state, await api('/me'));
  state.projects = await api('/projects');
  state.owners = await api('/owners');
  state.users = state.user.role === 'Administrador' ? await api('/users') : [];
  state.teams = state.user.role === 'Administrador' ? await api('/teams') : [];
  if (state.page === 'users' && state.user.role !== 'Administrador') state.page = 'projects';
  render();
}
const navItems = [['backlog', '☰', 'Product Backlog'], ['sprints', '◷', 'Sprints'], ['board', '▥', 'Tablero Kanban'], ['metrics', '↘', 'Métricas'], ['impediments', '⚠', 'Impedimentos']];
const activeProjects = () => state.projects.filter(project => !project.archived);
const currentProject = () => {
  const active = activeProjects();
  return active.find(project => project.id === state.currentProject) || active[0] || null;
};
async function openNav(key) {
  const project = currentProject();
  if (!project) return flash('Primero crea o selecciona un proyecto.');
  if (key === 'backlog') return storiesDialog(project);
  if (key === 'sprints') return sprintsDialog(project);
  if (key === 'board') return boardDialog(project);
  if (key === 'impediments') return impedimentsDialog(project);
  try {
    const sprints = await api(`/projects/${project.id}/sprints`);
    const sprint = sprints.find(item => item.status === 'Activo') || sprints.find(item => item.status === 'Cerrado') || sprints[0];
    if (!sprint) return flash('El proyecto todavía no tiene sprints.');
    await burndownDialog(project, sprint.id, 'sprints');
  } catch (error) { flash(error.message); }
}
function render() {
  const isAdmin = state.user.role === 'Administrador';
  const active = activeProjects();
  const current = currentProject();
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><img src="/logo.png" alt="Logo de MySCruEm"><strong>MySCruEm</strong></div><div class="workspace"><small>EMPRESA</small><strong>${escape(state.company.name)}</strong><span>${escape(state.company.code)}</span></div><nav aria-label="Navegación principal"><button data-page="projects" class="${state.page === 'projects' ? 'selected' : ''}"><span>▦</span> Proyectos</button>${active.length ? `<div class="nav-group"><small>PROYECTO ACTUAL</small><select id="current-project" aria-label="Proyecto actual">${active.map(project => `<option value="${project.id}" ${project.id === current?.id ? 'selected' : ''}>${escape(project.name)}</option>`).join('')}</select></div>${navItems.map(([key, icon, label]) => `<button data-nav="${key}"><span>${icon}</span> ${label}</button>`).join('')}` : ''}<div class="nav-group"><small>APRENDIZAJE</small></div><button data-page="training" class="${state.page === 'training' ? 'selected' : ''}"><span>✎</span> Capacitación</button>${isAdmin ? `<div class="nav-group"><small>ADMINISTRACIÓN</small></div><button data-page="users" class="${state.page === 'users' ? 'selected' : ''}"><span>♧</span> Usuarios y roles</button>` : ''}</nav><div class="sidebar-bottom"><span class="status-dot"></span> Espacio de trabajo</div></aside><div class="main"><header><span class="breadcrumb">${escape(state.company.name)} <span>/</span> ${state.page === 'users' ? 'Administración' : state.page === 'training' ? 'Capacitación' : 'Proyectos'}</span><div class="account"><div class="notifications"><button id="bell" class="bell" aria-label="Notificaciones" aria-expanded="false">🔔<span id="bell-count" class="bell-count" hidden></span></button><div id="notification-panel" class="notification-panel" hidden></div></div><div class="avatar">${escape(state.user.name.slice(0, 1).toUpperCase())}</div><div><strong>${escape(state.user.name)}</strong><small>${escape(state.user.role)}</small></div><button id="logout" class="quiet">Salir</button></div></header><main class="content"><div class="page-heading"><div><span class="eyebrow">ESPACIO DE TRABAJO</span><h1>${state.page === 'users' ? 'Usuarios y roles' : state.page === 'training' ? 'Capacitación en Scrum' : 'Tus proyectos'}</h1><p class="muted">${state.page === 'users' ? 'Administra los accesos y las responsabilidades de tu empresa.' : state.page === 'training' ? 'Aprende el marco de trabajo y cómo usarlo en MySCruEm.' : 'Un lugar para organizar cada nuevo producto.'}</p></div>${state.page === 'users' ? '<button id="new-user" class="primary">+ Invitar usuario</button>' : state.page === 'projects' && state.user.role === 'Product Owner' ? '<button id="new-project" class="primary">+ Nuevo proyecto</button>' : ''}</div><div id="page-content"></div></main></div></div>`;
  document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => { state.page = button.dataset.page; state.query = ''; render(); });
  document.querySelectorAll('[data-nav]').forEach(button => button.onclick = () => openNav(button.dataset.nav));
  document.querySelector('#current-project')?.addEventListener('change', event => { state.currentProject = Number(event.target.value); });
  setupNotifications();
  document.querySelector('#logout').onclick = async () => {
    try { await api('/logout', 'POST'); state = { page: 'projects', filter: 'active', query: '' }; authView(); }
    catch (error) { flash(error.message); }
  };
  document.querySelector('#new-user')?.addEventListener('click', () => userDialog());
  document.querySelector('#new-project')?.addEventListener('click', () => projectDialog());
  renderContent();
}
async function renderTraining() {
  const target = document.querySelector('#page-content');
  try {
    state.training ||= await api('/training');
    const guide = state.training;
    const module = guide.modules.find(item => item.id === state.trainingModule) || guide.modules[0];
    target.innerHTML = `<p class="training-intro">${escape(guide.intro)}</p><div class="training"><nav class="training-modules" aria-label="Módulos de la guía">${guide.modules.map(item => `<button data-module="${item.id}" class="${item.id === module.id && !['infografias', 'glosario'].includes(state.trainingModule) ? 'selected' : ''}">${escape(item.title)}</button>`).join('')}<button data-module="infografias" class="${state.trainingModule === 'infografias' ? 'selected' : ''}">Infografías</button><button data-module="glosario" class="${state.trainingModule === 'glosario' ? 'selected' : ''}">Glosario (${guide.terms} términos)</button></nav><section class="training-body" id="training-body"></section></div>`;
    const body = document.querySelector('#training-body');
    if (state.trainingModule === 'infografias') {
      body.innerHTML = `<h2>Infografías</h2><div class="infographics">${guide.infographics.map(item => `<figure><img src="${escape(item.src)}" alt="${escape(item.alt)}"><figcaption>${escape(item.title)}</figcaption></figure>`).join('')}</div>`;
    } else if (state.trainingModule === 'glosario') {
      body.innerHTML = `<h2>Glosario Scrum</h2><input id="glossary-search" placeholder="Buscar un término, por ejemplo: sprint" aria-label="Buscar en el glosario" value="${escape(state.glossaryQuery || '')}"><div id="glossary-results" class="glossary"></div>`;
      const search = async () => {
        const terms = await api(`/training/glossary?q=${encodeURIComponent(state.glossaryQuery || '')}`);
        document.querySelector('#glossary-results').innerHTML = terms.length ? terms.map(item => `<article><h3>${escape(item.term)}</h3><p>${escape(item.definition)}</p><small><strong>En MySCruEm:</strong> ${escape(item.example)}</small></article>`).join('') : '<p class="muted">No encontramos ese término.</p>';
      };
      document.querySelector('#glossary-search').oninput = event => { state.glossaryQuery = event.target.value; clearTimeout(timer); timer = setTimeout(() => search().catch(error => flash(error.message)), 200); };
      await search();
    } else {
      body.innerHTML = `<h2>${escape(module.title)}</h2><p class="muted">${escape(module.summary)}</p>${module.sections.map(section => `<article class="training-section"><h3>${escape(section.title)}</h3><p>${escape(section.body)}</p></article>`).join('')}`;
    }
    document.querySelectorAll('[data-module]').forEach(button => button.onclick = () => { state.trainingModule = button.dataset.module; renderTraining(); });
  } catch (error) { target.innerHTML = ''; flash(error.message); }
}
function setupNotifications() {
  const bell = document.querySelector('#bell');
  const panel = document.querySelector('#notification-panel');
  const count = document.querySelector('#bell-count');
  const show = unread => { count.hidden = !unread; count.textContent = unread > 9 ? '9+' : String(unread); };
  const load = async () => {
    const data = await api('/notifications');
    show(data.unread);
    return data;
  };
  const renderPanel = async () => {
    const data = await load();
    panel.innerHTML = `<div class="notification-head"><strong>Notificaciones</strong>${data.unread ? '<button id="read-all" class="quiet">Marcar todas como leídas</button>' : ''}</div>${data.items.length ? data.items.map(item => `<button class="notification ${item.read ? '' : 'unread'}" data-notification="${item.id}"><small>${escape(item.kind)} · ${escape(item.project || '')} · ${escape(item.created_at.slice(0, 16).replace('T', ' '))}</small><span>${escape(item.message)}</span></button>`).join('') : '<p class="muted">No tienes notificaciones.</p>'}`;
    panel.querySelector('#read-all')?.addEventListener('click', async event => { event.stopPropagation(); await api('/notifications/read', 'POST', { all: true }); await renderPanel(); });
    panel.querySelectorAll('[data-notification].unread').forEach(button => button.onclick = async event => { event.stopPropagation(); await api('/notifications/read', 'POST', { ids: [Number(button.dataset.notification)] }); await renderPanel(); });
  };
  bell.onclick = async event => {
    event.stopPropagation();
    panel.hidden = !panel.hidden;
    bell.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) { try { await renderPanel(); } catch (error) { flash(error.message); } }
  };
  panel.onclick = event => event.stopPropagation();
  if (!closeNotificationsBound) {
    closeNotificationsBound = true;
    document.addEventListener('click', () => {
      const open = document.querySelector('#notification-panel');
      if (open) { open.hidden = true; document.querySelector('#bell')?.setAttribute('aria-expanded', 'false'); }
    });
  }
  clearInterval(notificationTimer);
  notificationTimer = setInterval(() => { if (!state.user || !document.body.contains(bell)) return clearInterval(notificationTimer); load().catch(() => clearInterval(notificationTimer)); }, 20000);
  load().catch(() => {});
}
function rememberProject(id) {
  state.currentProject = Number(id);
  const select = document.querySelector('#current-project');
  if (select && [...select.options].some(option => option.value === String(id))) select.value = String(id);
}
function renderContent() {
  if (state.page === 'training') return renderTraining();
  const users = state.page === 'users';
  const source = users ? state.users : state.projects;
  const items = source.filter(item => (users || (state.filter === 'archived' ? item.archived : !item.archived)) && `${item.name} ${item.email || item.description}`.toLowerCase().includes(state.query.toLowerCase()));
  const target = document.querySelector('#page-content');
  target.innerHTML = `<div class="toolbar">${users ? `<span>${state.users.length} usuarios en la empresa</span>` : `<div class="tabs"><button data-filter="active" class="${state.filter === 'active' ? 'active' : ''}">Activos <span>${state.projects.filter(p => !p.archived).length}</span></button><button data-filter="archived" class="${state.filter === 'archived' ? 'active' : ''}">Archivados <span>${state.projects.filter(p => p.archived).length}</span></button></div>`}<input id="search" aria-label="${users ? 'Buscar usuarios' : 'Buscar proyectos'}" placeholder="${users ? 'Buscar por nombre o correo…' : 'Buscar proyectos…'}" value="${escape(state.query)}"></div>
  ${!items.length ? `<section class="empty"><div class="empty-icon">${users ? '♧' : '▦'}</div><h2>${state.query ? 'No encontramos coincidencias' : users ? 'No hay usuarios' : state.filter === 'archived' ? 'No hay proyectos archivados' : 'Aquí comienza tu próximo proyecto'}</h2><p>${state.query ? 'Prueba con otro nombre.' : users ? 'Invita a una persona para empezar.' : state.filter === 'archived' ? 'Los proyectos que archives seguirán disponibles aquí.' : state.user.role === 'Product Owner' ? 'Crea tu primer proyecto y dale un espacio a tus ideas.' : state.user.role === 'Administrador' ? 'Invita a un Product Owner para que cree el primer proyecto.' : 'Los proyectos de tu empresa aparecerán aquí.'}</p></section>` : users ? `<div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${items.map(user => `<tr><td><strong>${escape(user.name)}</strong><small>${escape(user.email)}</small></td><td>${escape(user.role)}</td><td>${badge(user.status, user.status === 'Activo' ? 'green' : '')}</td><td><button class="quiet" data-user="${user.id}">Editar</button>${user.status === 'Pendiente' ? `<button class="quiet" data-invite="${user.id}">Invitación</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="project-grid">${items.map(p => `<article class="project-card"><div class="card-top"><div class="project-icon">▦</div>${badge(p.archived ? 'Archivado' : 'Activo', p.archived ? '' : 'green')}</div><h2>${escape(p.name)}</h2><p>${escape(p.description)}</p><div class="project-owner"><div class="avatar">${escape(p.owner.slice(0, 1))}</div><div><small>PRODUCT OWNER</small><strong>${escape(p.owner)}</strong></div></div><div class="card-footer"><small>${new Date(p.created_at + 'Z').toLocaleDateString('es-MX')}</small><div><button class="quiet" data-board="${p.id}">Tablero</button><button class="quiet" data-sprints="${p.id}">Sprints</button><button class="quiet" data-backlog="${p.id}">Historias</button><button class="quiet" data-project="${p.id}">Ver proyecto →</button></div></div></article>`).join('')}</div>`}`;
  if (users) {
    target.insertAdjacentHTML('beforeend', `<section class="teams"><div class="teams-heading"><div><h2>Equipos</h2><p class="muted">Organiza a las personas por proyecto. Los Developers del equipo serán los responsables disponibles en su tablero.</p></div><button id="new-team" class="primary">+ Nuevo equipo</button></div>${state.teams.length ? `<div class="team-grid">${state.teams.map(team => `<article class="team-card"><div class="card-top"><h3>${escape(team.name)}</h3><button class="quiet" data-team="${team.id}">Editar</button></div><p class="muted">${team.project ? `Proyecto: ${escape(team.project)}` : 'Sin proyecto asignado'}</p><div class="team-members">${team.members.map(member => `<span class="chip">${escape(member.name)} · ${escape(member.role)}</span>`).join('') || '<span class="muted">Sin integrantes</span>'}</div></article>`).join('')}</div>` : '<p class="muted">Todavía no hay equipos.</p>'}</section>`);
    document.querySelector('#new-team').onclick = () => teamDialog();
    document.querySelectorAll('[data-team]').forEach(button => button.onclick = () => teamDialog(state.teams.find(team => team.id === Number(button.dataset.team))));
  }
  document.querySelector('#search').oninput = event => {
    const position = event.target.selectionStart;
    state.query = event.target.value;
    renderContent();
    const input = document.querySelector('#search');
    input.focus();
    input.setSelectionRange(position, position);
  };
  document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { state.filter = button.dataset.filter; renderContent(); });
  document.querySelectorAll('[data-user]').forEach(button => button.onclick = () => userDialog(state.users.find(u => u.id === Number(button.dataset.user))));
  document.querySelectorAll('[data-invite]').forEach(button => button.onclick = () => invitation(Number(button.dataset.invite)));
  document.querySelectorAll('[data-project]').forEach(button => button.onclick = () => projectDialog(state.projects.find(p => p.id === Number(button.dataset.project))));
  document.querySelectorAll('[data-backlog]').forEach(button => button.onclick = () => { rememberProject(button.dataset.backlog); storiesDialog(state.projects.find(p => p.id === Number(button.dataset.backlog))); });
  document.querySelectorAll('[data-sprints]').forEach(button => button.onclick = () => { rememberProject(button.dataset.sprints); sprintsDialog(state.projects.find(p => p.id === Number(button.dataset.sprints))); });
  document.querySelectorAll('[data-board]').forEach(button => button.onclick = () => { rememberProject(button.dataset.board); boardDialog(state.projects.find(p => p.id === Number(button.dataset.board))); });
}
function dialog(title, content, onSubmit) {
  modal.className = '';
  modal.innerHTML = `<div class="modal-heading"><h2>${escape(title)}</h2><button class="quiet" id="close-modal" aria-label="Cerrar">×</button></div>${content}`;
  document.querySelector('#close-modal').onclick = () => modal.close();
  if (!modal.open) modal.showModal();
  if (onSubmit) bindForm(modal.querySelector('form'), onSubmit);
}
async function invitation(id) {
  try {
    const result = await api(`/users/${id}/invitation`, 'POST');
    dialog('Invitación de acceso', `<p>${result.sent ? 'La invitación se envió por correo.' : 'No se envió correo. Comparte este enlace con la persona para activar su cuenta.'}</p><label>Enlace de activación<input readonly id="invite-url" value="${escape(result.url)}"></label><p class="muted">Válido por 48 horas. Al generar otro, el anterior deja de funcionar.</p><button id="copy" class="primary">Copiar enlace</button>`);
    document.querySelector('#copy').onclick = async () => {
      try { await navigator.clipboard.writeText(result.url); flash('Enlace copiado.'); }
      catch { document.querySelector('#invite-url').select(); flash('Selecciona y copia el enlace.'); }
    };
  } catch (error) { flash(error.message); }
}
function teamDialog(team) {
  const selected = new Set(team?.members.map(member => member.id) || []);
  const people = state.users.filter(user => user.role !== 'Administrador' && user.status !== 'Inactivo');
  dialog(team ? 'Editar equipo' : 'Nuevo equipo', `<form>${field('Nombre del equipo', 'name', 'text', team?.name || '', 'maxlength="120"')}<label>Proyecto<select name="projectId"><option value="">Sin proyecto</option>${state.projects.filter(project => !project.archived || project.id === team?.project_id).map(project => `<option value="${project.id}" ${project.id === team?.project_id ? 'selected' : ''}>${escape(project.name)}</option>`).join('')}</select></label><fieldset class="member-picker"><legend>Integrantes</legend>${people.map(user => `<label class="check"><input type="checkbox" name="member" value="${user.id}" ${selected.has(user.id) ? 'checked' : ''}> ${escape(user.name)} <small>${escape(user.role)}</small></label>`).join('') || '<p class="muted">Invita usuarios para formar equipos.</p>'}</fieldset><p class="form-error" role="alert"></p><button type="submit" class="primary">Guardar equipo</button></form>`, async data => {
    const memberIds = [...modal.querySelectorAll('[name=member]:checked')].map(input => Number(input.value));
    const body = { name: data.name, projectId: data.projectId ? Number(data.projectId) : null, memberIds };
    await api(team ? `/teams/${team.id}` : '/teams', team ? 'PATCH' : 'POST', body);
    modal.close();
    state.teams = await api('/teams');
    renderContent();
    flash(team ? 'Equipo actualizado.' : 'Equipo creado.');
  });
}
function userDialog(user) {
  dialog(user ? 'Editar usuario' : 'Invitar usuario', `<form>${field('Nombre', 'name', 'text', user?.name, 'maxlength="120"')}${field('Correo electrónico', 'email', 'email', user?.email, 'maxlength="254"')}<label>Rol<select name="role">${roleOptions(user?.role || 'Developer')}</select></label>${user ? `<label>Estado<select name="status">${(user.status === 'Pendiente' || !user.password && user.status === 'Inactivo' ? ['Pendiente', 'Activo', 'Inactivo'] : ['Activo', 'Inactivo']).map(s => `<option ${s === user.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>` : '<p class="muted">La persona definirá su contraseña al aceptar la invitación.</p>'}<p class="form-error" role="alert"></p><button type="submit" class="primary">${user ? 'Guardar cambios' : 'Crear invitación'}</button></form>`, async data => {
    const result = await api(user ? `/users/${user.id}` : '/users', user ? 'PATCH' : 'POST', data);
    modal.close();
    await load();
    if (!user) await invitation(result.id);
    else flash('Usuario actualizado.');
  });
}
function projectDialog(project) {
  const editable = !project || state.user.role === 'Product Owner' && project.owner_id === state.user.id;
  if (editable) {
    dialog(project ? 'Editar proyecto' : 'Nuevo proyecto', `<form>${field('Nombre del proyecto', 'name', 'text', project?.name, 'maxlength="120"')}<label>Descripción<textarea name="description" required maxlength="2000" rows="5">${escape(project?.description || '')}</textarea></label>${project ? `<label>Estado<select name="archived"><option value="false" ${!project.archived ? 'selected' : ''}>Activo</option><option value="true" ${project.archived ? 'selected' : ''}>Archivado</option></select></label>` : '<p class="muted">Serás el Product Owner de este proyecto.</p>'}<p class="form-error" role="alert"></p><button type="submit" class="primary">${project ? 'Guardar cambios' : 'Crear proyecto'}</button></form>`, async data => {
      await api(project ? `/projects/${project.id}` : '/projects', project ? 'PATCH' : 'POST', { ...data, archived: data.archived === 'true' });
      modal.close(); await load(); flash(project ? 'Proyecto actualizado.' : 'Proyecto creado.');
    });
  } else {
    dialog(project.name, `<p class="project-description">${escape(project.description)}</p>${badge(project.archived ? 'Archivado' : 'Activo', 'green')}<p>Product Owner: <strong>${escape(project.owner)}</strong></p>${state.user.role === 'Administrador' ? `<form><label>Asignar Product Owner<select name="ownerId" required>${state.owners.map(u => `<option value="${u.id}" ${project.owner_id === u.id ? 'selected' : ''}>${escape(u.name)}</option>`).join('')}</select></label><p class="muted">Cada proyecto tiene un único Product Owner.</p><p class="form-error" role="alert"></p><button type="submit" class="primary" ${!state.owners.length ? 'disabled' : ''}>Guardar responsable</button></form>` : ''}`, state.user.role === 'Administrador' ? async data => {
      await api(`/projects/${project.id}/owner`, 'PATCH', { ownerId: Number(data.ownerId) });
      modal.close(); await load(); flash('Product Owner actualizado.');
    } : undefined);
  }
}
async function storiesDialog(project) {
  try {
    const [stories, epics] = await Promise.all([api(`/projects/${project.id}/stories`), api(`/projects/${project.id}/epics`)]);
    const canCreate = !project.archived && state.user.role === 'Product Owner' && project.owner_id === state.user.id;
    const grouped = Boolean(state.groupEpics) && epics.length > 0;
    const epicName = new Map(epics.map(epic => [epic.id, epic.name]));
    const epicControl = story => canCreate ? `<label class="epic-select">Épica<select data-epic="${story.id}"><option value="">Sin épica</option>${epics.map(epic => `<option value="${epic.id}" ${story.epic_id === epic.id ? 'selected' : ''}>${escape(epic.name)}</option>`).join('')}</select></label>` : story.epic_id ? `<span class="chip">Épica: ${escape(epicName.get(story.epic_id))}</span>` : '';
    const storyCard = story => `<article class="story" data-story="${story.id}" draggable="${canCreate && !grouped}"><div class="story-toolbar"><small>HU-${story.id}</small>${canCreate && !grouped ? `<div><button class="quiet" data-move="${story.id}" data-direction="-1" aria-label="Subir ${escape(story.title)}" ${stories[0].id === story.id ? 'disabled' : ''}>↑</button><button class="quiet" data-move="${story.id}" data-direction="1" aria-label="Bajar ${escape(story.title)}" ${stories.at(-1).id === story.id ? 'disabled' : ''}>↓</button></div>` : ''}</div><div class="story-priority">${canCreate ? `<select aria-label="Prioridad de ${escape(story.title)}" data-priority="${story.id}">${['Must have','Should have','Could have','Won’t have'].map(priority => `<option ${story.priority === priority ? 'selected' : ''}>${priority}</option>`).join('')}</select>` : badge(story.priority)}</div><h3>${escape(story.title)}</h3><p>Como ${escape(story.actor)}, quiero ${escape(story.goal)}, para ${escape(story.benefit)}.</p><div class="story-points"><span>Puntos de historia</span>${state.user.role === 'Developer' && !project.archived ? `<select aria-label="Puntos de ${escape(story.title)}" data-estimate="${story.id}"><option value="" disabled ${story.points == null ? 'selected' : ''}>Sin estimar</option>${[1,2,3,5,8,13,21].map(points => `<option value="${points}" ${story.points === points ? 'selected' : ''}>${points}</option>`).join('')}</select>` : `<strong>${story.points ?? 'Sin estimar'}</strong>`}</div>${epicControl(story)}<button class="quiet story-tasks" data-story-tasks="${story.id}">Ver tareas y avance</button><strong>Criterios de aceptación</strong><ul>${story.criteria.map(criterion => `<li>${escape(criterion)}</li>`).join('')}</ul></article>`;
    const groups = [...epics.map(epic => ({ title: epic.name, description: epic.description, items: stories.filter(story => story.epic_id === epic.id) })), { title: 'Sin épica', description: '', items: stories.filter(story => !story.epic_id) }].filter(group => group.items.length);
    const list = grouped ? groups.map(group => `<section class="epic-group"><div class="epic-heading"><h3>${escape(group.title)}</h3><span>${group.items.length} historias · ${group.items.reduce((sum, story) => sum + (story.points || 0), 0)} puntos</span></div>${group.description ? `<p class="muted">${escape(group.description)}</p>` : ''}<div class="story-list">${group.items.map(storyCard).join('')}</div></section>`).join('') : `<div class="story-list">${stories.map(storyCard).join('')}</div>`;
    dialog('Historias de usuario', `<p class="muted">${escape(project.name)} · ${stories.length} ${stories.length === 1 ? 'historia' : 'historias'} · ${epics.length} ${epics.length === 1 ? 'épica' : 'épicas'}</p><div class="backlog-tools">${canCreate ? '<button id="new-story" class="primary">+ Nueva historia</button><button id="manage-epics" class="quiet">Épicas</button>' : ''}<button id="show-dod" class="quiet">Definition of Done</button>${epics.length ? `<label class="check"><input type="checkbox" id="group-epics" ${grouped ? 'checked' : ''}> Agrupar por épica</label>` : ''}</div>${stories.length ? list : '<p class="muted">Este proyecto todavía no tiene historias de usuario.</p>'}`);
    document.querySelectorAll('[data-story-tasks]').forEach(button => button.onclick = () => storyTasksDialog(project, Number(button.dataset.storyTasks)));
    document.querySelector('#show-dod').onclick = () => dodDialog(project);
    document.querySelector('#manage-epics')?.addEventListener('click', () => epicsDialog(project, epics));
    document.querySelector('#group-epics')?.addEventListener('change', event => { state.groupEpics = event.target.checked; storiesDialog(project); });
    document.querySelectorAll('[data-epic]').forEach(input => input.onchange = async () => {
      input.disabled = true;
      try { await api(`/projects/${project.id}/stories/${input.dataset.epic}/epic`, 'PATCH', { epicId: input.value ? Number(input.value) : null }); }
      catch (error) { flash(error.message); }
      await storiesDialog(project);
    });
    document.querySelector('#new-story')?.addEventListener('click', () => storyForm(project));
    const saveOrder = async order => {
      try { await api(`/projects/${project.id}/stories/order`, 'PATCH', { order }); }
      catch (error) { flash(error.message); }
      await storiesDialog(project);
    };
    document.querySelectorAll('[data-move]').forEach(button => button.onclick = () => {
      const order = stories.map(story => story.id);
      const index = order.indexOf(Number(button.dataset.move));
      const next = index + Number(button.dataset.direction);
      if (next < 0 || next >= order.length) return;
      [order[index], order[next]] = [order[next], order[index]];
      saveOrder(order);
    });
    document.querySelectorAll('[data-priority]').forEach(input => input.onchange = async () => {
      input.disabled = true;
      try { await api(`/projects/${project.id}/stories/${input.dataset.priority}/priority`, 'PATCH', { priority: input.value }); }
      catch (error) { flash(error.message); }
      await storiesDialog(project);
    });
    if (canCreate && !grouped) {
      let dragged;
      document.querySelectorAll('[data-story]').forEach(card => {
        card.ondragstart = event => { dragged = Number(card.dataset.story); event.dataTransfer.setData('text/plain', String(dragged)); card.classList.add('dragging'); };
        card.ondragend = () => { dragged = null; card.classList.remove('dragging'); };
        card.ondragover = event => { if (dragged) event.preventDefault(); };
        card.ondrop = event => {
          event.preventDefault();
          if (!dragged || dragged === Number(card.dataset.story)) return;
          const order = stories.map(story => story.id).filter(id => id !== dragged);
          order.splice(order.indexOf(Number(card.dataset.story)), 0, dragged);
          saveOrder(order);
        };
      });
    }
    document.querySelectorAll('[data-estimate]').forEach(input => input.onchange = async () => {
      input.disabled = true;
      try {
        await api(`/projects/${project.id}/stories/${input.dataset.estimate}/estimate`, 'PATCH', { points: Number(input.value) });
        await storiesDialog(project);
      } catch (error) { flash(error.message); await storiesDialog(project); }
    });
  } catch (error) { flash(error.message); }
}
async function storyTasksDialog(project, storyId) {
  try {
    const detail = await api(`/projects/${project.id}/stories/${storyId}/tasks`);
    dialog(`HU-${detail.story.id} · ${detail.story.title}`, `<p class="muted">${escape(project.name)} · ${detail.story.points ?? 'Sin estimar'} puntos</p><div class="progress"><div class="progress-bar"><span style="width:${detail.progress}%"></span></div><strong>${detail.progress} %</strong><small>${detail.done} de ${detail.total} tareas terminadas</small></div>${detail.tasks.length ? `<div class="table-wrap"><table><thead><tr><th>Tarea</th><th>Responsable</th><th>Sprint</th><th>Estado</th></tr></thead><tbody>${detail.tasks.map(task => `<tr><td>${escape(task.title)}</td><td>${escape(task.assignee)}</td><td>${escape(task.sprint)}</td><td>${badge(task.status, task.status === 'Terminado' ? 'green' : '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">La historia todavía no tiene tareas. Se crean desde el tablero del sprint activo.</p>'}<div class="story-actions"><button id="back-stories" class="quiet">Volver al backlog</button></div>`);
    modal.classList.add('wide-modal');
    document.querySelector('#back-stories').onclick = () => storiesDialog(project);
  } catch (error) { flash(error.message); }
}
async function dodDialog(project) {
  try {
    const dod = await api(`/projects/${project.id}/dod`);
    const canEdit = !project.archived && state.user.role === 'Product Owner' && project.owner_id === state.user.id;
    const list = dod.criteria.length ? `<ol class="dod-list">${dod.criteria.map(item => `<li>${escape(item)}</li>`).join('')}</ol><p class="muted">Actualizada por ${escape(dod.updated_by || '—')} el ${escape((dod.updated_at || '').slice(0, 10))}</p>` : '<p class="muted">El proyecto todavía no tiene Definition of Done.</p>';
    dialog('Definition of Done', `<p class="muted">${escape(project.name)} · Criterios que debe cumplir toda historia para considerarse terminada.</p>${canEdit ? `<form><label>Criterios (uno por línea, máximo 15)<textarea name="criteria" rows="8" maxlength="3200">${escape(dod.criteria.join('\n'))}</textarea></label><p class="form-error" role="alert"></p><div class="story-actions"><button type="button" id="back-stories" class="quiet">Volver al backlog</button><button type="submit" class="primary">Guardar Definition of Done</button></div></form>` : `${list}<div class="story-actions"><button id="back-stories" class="quiet">Volver al backlog</button></div>`}`, async data => {
      await api(`/projects/${project.id}/dod`, 'PUT', { criteria: data.criteria.split('\n').map(item => item.trim()).filter(Boolean) });
      flash('Definition of Done guardada.');
      await dodDialog(project);
    });
    document.querySelector('#back-stories').onclick = () => storiesDialog(project);
  } catch (error) { flash(error.message); }
}
function doneReminder(project, task, criteria) {
  dialog('Antes de mover a Terminado', `<p class="muted">Tarea: ${escape(task.title)}</p><p>Confirma que el trabajo cumple la Definition of Done del proyecto:</p><div class="dod-check">${criteria.map((item, index) => `<label class="check"><input type="checkbox" data-dod="${index}"> ${escape(item)}</label>`).join('')}</div><p class="form-error" role="alert"></p><div class="story-actions"><button id="cancel-done" class="quiet">Cancelar</button><button id="confirm-done" class="primary">Mover a Terminado</button></div>`);
  document.querySelector('#cancel-done').onclick = () => boardDialog(project);
  document.querySelector('#confirm-done').onclick = async event => {
    if ([...modal.querySelectorAll('[data-dod]')].some(input => !input.checked)) {
      modal.querySelector('.form-error').textContent = 'Marca todos los criterios para continuar.';
      return;
    }
    event.target.disabled = true;
    try { await api(`/projects/${project.id}/tasks/${task.id}/status`, 'PATCH', { status: 'Terminado' }); }
    catch (error) { flash(error.message); }
    await boardDialog(project);
  };
}
function epicsDialog(project, epics, editing) {
  dialog('Épicas del proyecto', `<p class="muted">${escape(project.name)}</p>${epics.length ? `<div class="epic-list">${epics.map(epic => `<article class="planning-story"><div><strong>${escape(epic.name)}</strong><small>${epic.stories} historias · ${epic.points} puntos${epic.description ? ` · ${escape(epic.description)}` : ''}</small></div><button class="quiet" data-edit-epic="${epic.id}">Editar</button></article>`).join('')}</div>` : '<p class="muted">Todavía no hay épicas.</p>'}<form><h3>${editing ? 'Editar épica' : 'Nueva épica'}</h3>${field('Nombre', 'name', 'text', editing?.name || '', 'maxlength="120"')}<label>Descripción<textarea name="description" maxlength="1000" rows="2" placeholder="Opcional">${escape(editing?.description || '')}</textarea></label><p class="form-error" role="alert"></p><div class="story-actions"><button type="button" id="back-stories" class="quiet">Volver al backlog</button><button type="submit" class="primary">Guardar épica</button></div></form>`, async data => {
    await api(editing ? `/projects/${project.id}/epics/${editing.id}` : `/projects/${project.id}/epics`, editing ? 'PATCH' : 'POST', data);
    flash(editing ? 'Épica actualizada.' : 'Épica creada.');
    epicsDialog(project, await api(`/projects/${project.id}/epics`));
  });
  document.querySelector('#back-stories').onclick = () => storiesDialog(project);
  document.querySelectorAll('[data-edit-epic]').forEach(button => button.onclick = () => epicsDialog(project, epics, epics.find(epic => epic.id === Number(button.dataset.editEpic))));
}
function storyForm(project) {
  dialog('Nueva historia de usuario', `<form>${field('Título', 'title', 'text', '', 'maxlength="120"')}${field('Como', 'actor', 'text', '', 'maxlength="300"')}${field('Quiero', 'goal', 'text', '', 'maxlength="1000"')}${field('Para', 'benefit', 'text', '', 'maxlength="1000"')}<label>Criterios de aceptación<textarea name="criteria" required rows="4" maxlength="15000" placeholder="Escribe un criterio por línea"></textarea></label><p class="form-error" role="alert"></p><div class="story-actions"><button type="button" id="back-stories" class="quiet">Volver</button><button type="submit" class="primary">Guardar historia</button></div></form>`, async data => {
    await api(`/projects/${project.id}/stories`, 'POST', { ...data, criteria: data.criteria.split(/\r?\n/).map(value => value.trim()).filter(Boolean) });
    await storiesDialog(project);
    flash('Historia creada.');
  });
  document.querySelector('#back-stories').onclick = () => storiesDialog(project);
}
async function sprintsDialog(project) {
  try {
    const sprints = await api(`/projects/${project.id}/sprints`);
    dialog('Sprints del proyecto', `<p class="muted">${escape(project.name)}</p>${state.user.role === 'Scrum Master' && !project.archived ? '<button id="new-sprint" class="primary">+ Nuevo sprint</button>' : ''}${sprints.length ? `<div class="story-list">${sprints.map(sprint => `<article class="story"><h3>${escape(sprint.name)}</h3>${badge(sprint.status)}<p>${escape(sprint.start_date)} al ${escape(sprint.end_date)}</p><p class="project-description">${escape(sprint.goal)}</p>${sprint.status === 'Cerrado' ? `<p class="muted">Completados ${sprint.completed_points ?? 0} de ${sprint.committed_points ?? 0} puntos</p>` : ''}<div class="sprint-actions"><button class="quiet" data-metrics="${sprint.id}">Métricas</button><button class="quiet" data-plan="${sprint.id}">${state.user.role === 'Developer' && !project.archived && sprint.status === 'En planificación' ? 'Planificar' : 'Ver historias'}</button>${state.user.role === 'Scrum Master' && !project.archived && sprint.status === 'En planificación' ? `<button class="primary" data-start="${sprint.id}">Iniciar sprint</button>` : ''}${state.user.role === 'Scrum Master' && !project.archived && sprint.status === 'Activo' ? `<button class="primary" data-close="${sprint.id}">Cerrar sprint</button>` : ''}</div></article>`).join('')}</div>` : '<p class="muted">Este proyecto todavía no tiene sprints.</p>'}`);
    document.querySelector('#new-sprint')?.addEventListener('click', () => sprintForm(project));
    document.querySelectorAll('[data-plan]').forEach(button => button.onclick = () => planningDialog(project, sprints.find(sprint => sprint.id === Number(button.dataset.plan))));
    document.querySelectorAll('[data-metrics]').forEach(button => button.onclick = () => burndownDialog(project, Number(button.dataset.metrics), 'sprints'));
    document.querySelectorAll('[data-start]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      try { await api(`/projects/${project.id}/sprints/${button.dataset.start}/start`, 'POST'); flash('Sprint iniciado. El tablero está disponible.'); }
      catch (error) { flash(error.message); }
      await sprintsDialog(project);
    });
    document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => closeDialog(project, sprints.find(sprint => sprint.id === Number(button.dataset.close))));
  } catch (error) { flash(error.message); }
}
async function closeDialog(project, sprint) {
  try {
    const result = await api(`/projects/${project.id}/sprints/${sprint.id}/stories`);
    const done = result.stories.filter(story => story.completed);
    const pending = result.stories.filter(story => !story.completed);
    const completed = done.reduce((sum, story) => sum + (story.points || 0), 0);
    const item = story => `<article class="planning-story"><strong>${escape(story.title)}</strong><small>${story.points ?? 0} puntos</small></article>`;
    dialog(`Cerrar ${sprint.name}`, `<p class="muted">Revisa el resumen antes de confirmar el cierre.</p><div class="close-stats"><div><small>Puntos comprometidos</small><strong>${sprint.committed_points ?? result.points}</strong></div><div><small>Puntos completados</small><strong>${completed}</strong></div></div><h3>Historias terminadas</h3>${done.length ? done.map(item).join('') : '<p class="muted">Ninguna historia está terminada.</p>'}<h3>Regresan al Product Backlog</h3>${pending.length ? pending.map(item).join('') : '<p class="muted">No hay historias pendientes.</p>'}<div class="story-actions"><button id="back-sprint-list" class="quiet">Cancelar</button><button id="confirm-close" class="primary">Confirmar cierre</button></div>`);
    document.querySelector('#back-sprint-list').onclick = () => sprintsDialog(project);
    document.querySelector('#confirm-close').onclick = async event => {
      event.target.disabled = true;
      try {
        const summary = await api(`/projects/${project.id}/sprints/${sprint.id}/close`, 'POST');
        flash(`Sprint cerrado: ${summary.completed} de ${summary.committed} puntos completados; ${summary.returned} historias regresan al backlog.`);
      } catch (error) { flash(error.message); }
      await sprintsDialog(project);
    };
  } catch (error) { flash(error.message); }
}
function sprintForm(project) {
  dialog('Nuevo sprint', `<form>${field('Nombre del sprint', 'name', 'text', '', 'maxlength="120"')}<div class="sprint-dates">${field('Inicio', 'startDate', 'date')}${field('Fin', 'endDate', 'date')}</div><label>Meta del sprint<textarea name="goal" required maxlength="2000" rows="4"></textarea></label><p class="form-error" role="alert"></p><div class="story-actions"><button type="button" id="back-sprints" class="quiet">Volver</button><button type="submit" class="primary">Guardar sprint</button></div></form>`, async data => {
    await api(`/projects/${project.id}/sprints`, 'POST', data);
    await sprintsDialog(project);
    flash('Sprint creado.');
  });
  document.querySelector('#back-sprints').onclick = () => sprintsDialog(project);
}
async function planningDialog(project, sprint) {
  try {
    const selected = await api(`/projects/${project.id}/sprints/${sprint.id}/stories`);
    const allStories = await api(`/projects/${project.id}/stories`);
    const available = allStories.filter(story => !story.sprint_id);
    const editable = state.user.role === 'Developer' && !project.archived && sprint.status === 'En planificación';
    const row = (story, included) => `<article class="planning-story"><div><strong>${escape(story.title)}</strong><small>${escape(story.priority)} · ${story.points ?? 'Sin estimar'} puntos</small></div>${editable ? `<button class="quiet" data-selection="${story.id}" data-included="${included}" ${!included && (!story.points || story.points > 13) ? 'disabled' : ''} aria-label="${included ? 'Retirar' : 'Agregar'} ${escape(story.title)}">${included ? '−' : '+'}</button>` : ''}</article>`;
    dialog('Sprint Backlog', `<p class="muted">${escape(project.name)} · ${escape(sprint.name)}</p><p class="project-description">${escape(sprint.goal)}</p><div class="planning-columns"><section><h3>Product Backlog</h3>${available.length ? available.map(story => row(story, false)).join('') : '<p class="muted">No hay historias disponibles.</p>'}</section><section><h3>Historias seleccionadas</h3>${selected.stories.length ? selected.stories.map(story => row(story, true)).join('') : '<p class="muted">Aún no se han seleccionado historias.</p>'}</section></div><div class="planning-total"><strong>${selected.points} puntos comprometidos</strong><button id="back-sprint-list" class="quiet">Volver a sprints</button></div>${editable ? '<p class="muted">Cada cambio se guarda automáticamente. Solo se pueden seleccionar historias estimadas de hasta 13 puntos.</p>' : ''}`);
    modal.classList.add('planning-modal');
    document.querySelector('#back-sprint-list').onclick = () => sprintsDialog(project);
    document.querySelectorAll('[data-selection]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        const path = `/projects/${project.id}/sprints/${sprint.id}/stories`;
        if (button.dataset.included === 'true') await api(`${path}/${button.dataset.selection}`, 'DELETE');
        else await api(path, 'POST', { storyId: Number(button.dataset.selection) });
      } catch (error) { flash(error.message); }
      await planningDialog(project, sprint);
    });
  } catch (error) { flash(error.message); }
}
async function boardDialog(project) {
  try {
    const [board, dod] = await Promise.all([api(`/projects/${project.id}/board`), api(`/projects/${project.id}/dod`)]);
    if (!board.sprint) {
      dialog('Tablero Kanban', `<p class="muted">${escape(project.name)}</p><section class="empty"><div class="empty-icon">▦</div><h2>No hay un sprint activo</h2><p>El tablero se habilita cuando el Scrum Master inicia un sprint.</p></section>`);
      return;
    }
    const stories = new Map(board.stories.map(story => [story.id, story]));
    const canMove = state.user.role === 'Developer' && !project.archived;
    const card = task => `<article class="task-card ${task.impediment ? 'blocked' : ''}" data-task="${task.id}" draggable="${canMove}"><strong>${escape(task.title)}</strong><small>HU-${task.story_id} · ${escape(stories.get(task.story_id)?.title || '')}</small><div class="task-tags"><span class="chip type-${escape(task.type.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())}">${escape(task.type)}</span>${task.label ? `<span class="chip">${escape(task.label)}</span>` : ''}</div>${task.impediment ? `<p class="impediment-note"><strong>⚠ Impedimento:</strong> ${escape(task.impediment)}</p>` : canMove && task.status !== 'Terminado' ? `<button class="quiet impediment-button" data-impediment="${task.id}">⚠ Registrar impedimento</button>` : ''}<div class="task-owner"><span class="avatar">${escape(task.assignee.slice(0, 1).toUpperCase())}</span>${escape(task.assignee)}</div></article>`;
    const filters = state.boardFilters?.project === project.id ? state.boardFilters : { project: project.id, assignee: '', label: '', type: '' };
    state.boardFilters = filters;
    const visible = board.tasks.filter(task => (!filters.assignee || task.assignee_id === Number(filters.assignee)) && (!filters.label || task.label === filters.label) && (!filters.type || task.type === filters.type));
    const active = Boolean(filters.assignee || filters.label || filters.type);
    const people = [...new Map(board.tasks.map(task => [task.assignee_id, task.assignee])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const select = (key, label, items) => `<label>${label}<select data-filter-board="${key}"><option value="">Todos</option>${items.map(([value, text]) => `<option value="${escape(value)}" ${String(filters[key]) === String(value) ? 'selected' : ''}>${escape(text)}</option>`).join('')}</select></label>`;
    const filterBar = `<div class="board-filters">${select('assignee', 'Miembro', people)}${select('label', 'Etiqueta', board.labels.map(label => [label, label]))}${select('type', 'Tipo', board.types.map(type => [type, type]))}<button id="clear-filters" class="quiet" ${active ? '' : 'disabled'}>Limpiar filtros</button>${active ? `<span class="muted">Mostrando ${visible.length} de ${board.tasks.length} tareas</span>` : ''}</div>`;
    const grouped = new Map(board.columns.map(name => [name, []]));
    for (const task of visible) grouped.get(task.status)?.push(task);
    const column = name => {
      const tasks = grouped.get(name);
      return `<section class="board-column" data-column="${escape(name)}"><h3>${escape(name)} <span>${tasks.length}</span></h3><div class="board-cards">${tasks.map(card).join('') || '<p class="muted">Sin tarjetas</p>'}</div></section>`;
    };
    dialog('Tablero Kanban', `<div class="board-heading"><div><p class="muted">${escape(project.name)} · ${escape(board.sprint.name)} · Del ${escape(board.sprint.start_date)} al ${escape(board.sprint.end_date)}</p><p class="project-description"><strong>Meta:</strong> ${escape(board.sprint.goal)}</p></div><div class="board-tools"><button id="board-impediments" class="quiet">Impedimentos${board.tasks.some(task => task.impediment) ? ` (${board.tasks.filter(task => task.impediment).length})` : ''}</button><button id="board-metrics" class="quiet">Métricas</button>${canMove ? '<button id="new-task" class="primary">+ Nueva tarea</button>' : ''}</div></div>${filterBar}<div class="board">${board.columns.map(column).join('')}</div><p class="muted">${board.tasks.length} tareas · ${board.sprint.committed_points ?? 0} puntos comprometidos</p>`);
    modal.classList.add('board-modal');
    document.querySelectorAll('[data-impediment]').forEach(button => button.onclick = event => { event.stopPropagation(); clearInterval(boardTimer); impedimentForm(project, board.tasks.find(task => task.id === Number(button.dataset.impediment))); });
    document.querySelectorAll('[data-filter-board]').forEach(input => input.onchange = () => { filters[input.dataset.filterBoard] = input.value; boardDialog(project); });
    document.querySelector('#clear-filters').onclick = () => { Object.assign(filters, { assignee: '', label: '', type: '' }); boardDialog(project); };
    document.querySelector('#board-impediments').onclick = () => { clearInterval(boardTimer); impedimentsDialog(project, 'board'); };
    document.querySelector('#board-metrics').onclick = () => { clearInterval(boardTimer); burndownDialog(project, board.sprint.id, 'board'); };
    document.querySelector('#new-task')?.addEventListener('click', () => { clearInterval(boardTimer); taskForm(project, board); });
    clearInterval(boardTimer);
    boardTimer = setInterval(async () => {
      if (!modal.open || !modal.classList.contains('board-modal')) return clearInterval(boardTimer);
      if (document.querySelector('.task-card.dragging')) return;
      try {
        const current = await api(`/projects/${project.id}/board/version`);
        if (current.sprintId !== board.sprint.id || current.version !== board.sprint.board_version) {
          clearInterval(boardTimer);
          await boardDialog(project);
        }
      } catch { clearInterval(boardTimer); }
    }, 4000);
    if (canMove) {
      let dragged;
      document.querySelectorAll('[data-task]').forEach(item => {
        item.ondragstart = event => { dragged = item; event.dataTransfer.setData('text/plain', item.dataset.task); item.classList.add('dragging'); };
        item.ondragend = () => { item.classList.remove('dragging'); dragged = null; };
      });
      document.querySelectorAll('[data-column]').forEach(area => {
        area.ondragover = event => { if (dragged) { event.preventDefault(); area.classList.add('drop-target'); } };
        area.ondragleave = () => area.classList.remove('drop-target');
        area.ondrop = async event => {
          event.preventDefault();
          area.classList.remove('drop-target');
          const task = board.tasks.find(item => item.id === Number(dragged?.dataset.task));
          if (!task || task.status === area.dataset.column) return;
          if (area.dataset.column === 'Terminado' && dod.criteria.length) {
            clearInterval(boardTimer);
            return doneReminder(project, task, dod.criteria);
          }
          area.querySelector('.board-cards').append(dragged);
          try { await api(`/projects/${project.id}/tasks/${task.id}/status`, 'PATCH', { status: area.dataset.column }); }
          catch (error) { flash(error.message); }
          await boardDialog(project);
        };
      });
    }
  } catch (error) { flash(error.message); }
}
async function impedimentsDialog(project, from = 'nav', status = 'Abierto') {
  try {
    clearInterval(boardTimer);
    const items = await api(`/projects/${project.id}/impediments?status=${encodeURIComponent(status)}`);
    const canClose = state.user.role === 'Scrum Master' && !project.archived;
    dialog('Impedimentos', `<p class="muted">${escape(project.name)}</p><div class="tabs"><button data-imp-status="Abierto" class="${status === 'Abierto' ? 'active' : ''}">Abiertos</button><button data-imp-status="Cerrado" class="${status === 'Cerrado' ? 'active' : ''}">Cerrados</button></div>${items.length ? `<div class="impediment-list">${items.map(item => `<article class="impediment ${item.status === 'Abierto' ? 'open' : ''}"><div class="card-top"><strong>${escape(item.task)}</strong>${badge(item.status, item.status === 'Cerrado' ? 'green' : '')}</div><p>${escape(item.description)}</p><small class="muted">HU-${item.story_id} · ${escape(item.sprint)} · Reportó ${escape(item.reported_by)} el ${escape(item.created_at.slice(0, 10))}</small>${item.status === 'Cerrado' ? `<p class="solution"><strong>Solución:</strong> ${escape(item.solution)} <small>(${escape(item.closed_by)}, ${escape(item.closed_at.slice(0, 10))})</small></p>` : canClose ? `<form class="close-impediment" data-close-impediment="${item.id}"><input name="solution" required maxlength="500" placeholder="¿Cómo se resolvió?"><button type="submit" class="primary">Cerrar impedimento</button></form>` : ''}</article>`).join('')}</div>` : `<section class="empty"><h2>${status === 'Abierto' ? 'No hay impedimentos abiertos' : 'No hay impedimentos cerrados'}</h2><p>${status === 'Abierto' ? 'Cuando un Developer registre un bloqueo aparecerá aquí.' : 'Los impedimentos resueltos se conservan en este historial.'}</p></section>`}${from === 'board' ? '<div class="story-actions"><button id="back-board" class="quiet">Volver al tablero</button></div>' : ''}`);
    document.querySelector('#back-board')?.addEventListener('click', () => boardDialog(project));
    document.querySelectorAll('[data-imp-status]').forEach(button => button.onclick = () => impedimentsDialog(project, from, button.dataset.impStatus));
    document.querySelectorAll('[data-close-impediment]').forEach(form => form.onsubmit = async event => {
      event.preventDefault();
      form.querySelector('button').disabled = true;
      try {
        await api(`/projects/${project.id}/impediments/${form.dataset.closeImpediment}/close`, 'POST', { solution: form.solution.value });
        flash('Impedimento cerrado.');
      } catch (error) { flash(error.message); }
      await impedimentsDialog(project, from, status);
    });
  } catch (error) { flash(error.message); }
}
function impedimentForm(project, task) {
  dialog('Registrar impedimento', `<form><p class="muted">Tarea: ${escape(task.title)}</p><label>¿Qué impide avanzar?<textarea name="description" required maxlength="500" rows="4" placeholder="Describe el bloqueo y lo que necesitas para resolverlo"></textarea></label><p class="form-error" role="alert"></p><div class="story-actions"><button type="button" id="back-board" class="quiet">Volver</button><button type="submit" class="primary">Registrar impedimento</button></div></form>`, async data => {
    await api(`/projects/${project.id}/tasks/${task.id}/impediments`, 'POST', data);
    await boardDialog(project);
    flash('Impedimento registrado. El Scrum Master lo verá en su lista.');
  });
  document.querySelector('#back-board').onclick = () => boardDialog(project);
}
function taskForm(project, board) {
  const options = (items, label) => items.map(item => `<option value="${item.id}">${escape(label(item))}</option>`).join('');
  dialog('Nueva tarea', `<form><p class="muted">La tarea se agregará a la columna Por hacer.</p>${field('Título', 'title', 'text', '', 'maxlength="120"')}<label>Historia del sprint<select name="storyId" required>${options(board.stories, story => `HU-${story.id} · ${story.title}`)}</select></label><label>Responsable<select name="assigneeId" required>${options(board.members, member => member.name)}</select></label><div class="form-row"><label>Tipo<select name="type">${board.types.map(type => `<option>${escape(type)}</option>`).join('')}</select></label><label>Etiqueta<input name="label" maxlength="40" list="task-labels" placeholder="Opcional, por ejemplo: Frontend"><datalist id="task-labels">${board.labels.map(label => `<option value="${escape(label)}">`).join('')}</datalist></label></div><label>Descripción<textarea name="description" maxlength="1000" rows="3" placeholder="Opcional"></textarea></label><p class="form-error" role="alert"></p><div class="story-actions"><button type="button" id="back-board" class="quiet">Volver</button><button type="submit" class="primary">Guardar tarea</button></div></form>`, async data => {
    await api(`/projects/${project.id}/tasks`, 'POST', { ...data, storyId: Number(data.storyId), assigneeId: Number(data.assigneeId) });
    await boardDialog(project);
    flash('Tarea creada.');
  });
  document.querySelector('#back-board').onclick = () => boardDialog(project);
}
function burndownChart(data) {
  const width = 820, height = 340, left = 46, right = 20, top = 16, bottom = 40;
  const max = Math.max(data.committed, 1);
  const x = index => left + index * (width - left - right) / Math.max(data.days.length - 1, 1);
  const y = value => top + (height - top - bottom) * (1 - value / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(step => Math.round(max * step));
  const line = key => data.days.map((day, index) => day[key] === null ? null : `${x(index)},${y(day[key])}`).filter(Boolean).join(' ');
  return `<svg class="burndown-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico Burndown">${ticks.map(tick => `<line x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}" class="grid"/><text x="${left - 10}" y="${y(tick) + 4}" text-anchor="end">${tick}</text>`).join('')}${data.days.map((day, index) => `<text x="${x(index)}" y="${height - 14}" text-anchor="middle">${escape(day.date.slice(8))}/${escape(day.date.slice(5, 7))}</text>`).join('')}<polyline points="${line('ideal')}" class="ideal"/><polyline points="${line('remaining')}" class="real"/>${data.days.map((day, index) => day.remaining === null ? '' : `<circle cx="${x(index)}" cy="${y(day.remaining)}" r="4" class="real-point"><title>${escape(day.date)}: ${day.remaining} puntos</title></circle>`).join('')}</svg>`;
}
function velocityChart(data) {
  const width = 820, height = 280, left = 46, right = 20, top = 16, bottom = 44;
  const max = Math.max(...data.sprints.map(sprint => Math.max(sprint.committed, sprint.completed)), 1);
  const slot = (width - left - right) / data.sprints.length;
  const bar = Math.min(34, slot / 3);
  const y = value => top + (height - top - bottom) * (1 - value / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(step => Math.round(max * step));
  return `<svg class="burndown-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfica de velocidad">${ticks.map(tick => `<line x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}" class="grid"/><text x="${left - 10}" y="${y(tick) + 4}" text-anchor="end">${tick}</text>`).join('')}${data.sprints.map((sprint, index) => { const center = left + slot * index + slot / 2; return `<rect x="${center - bar - 2}" y="${y(sprint.committed)}" width="${bar}" height="${y(0) - y(sprint.committed)}" class="bar-committed"><title>${escape(sprint.name)}: ${sprint.committed} comprometidos</title></rect><rect x="${center + 2}" y="${y(sprint.completed)}" width="${bar}" height="${y(0) - y(sprint.completed)}" class="bar-completed"><title>${escape(sprint.name)}: ${sprint.completed} completados</title></rect><text x="${center + bar / 2 + 2}" y="${y(sprint.completed) - 6}" text-anchor="middle" class="bar-value">${sprint.completed}</text><text x="${center}" y="${height - 16}" text-anchor="middle">${escape(sprint.name)}</text>`; }).join('')}<line x1="${left}" x2="${width - right}" y1="${y(data.average)}" y2="${y(data.average)}" class="average"/></svg>`;
}
async function burndownDialog(project, sprintId, from = 'sprints') {
  try {
    const [data, velocity] = await Promise.all([api(`/projects/${project.id}/sprints/${sprintId}/burndown`), api(`/projects/${project.id}/velocity`)]);
    dialog('Métricas del sprint', `<p class="muted">${escape(project.name)} · ${escape(data.sprint.name)} · ${escape(data.sprint.status)}</p><div class="metric-cards"><div><small>Puntos comprometidos</small><strong>${data.committed}</strong></div><div><small>Puntos completados</small><strong>${data.completed}</strong></div><div><small>Puntos restantes</small><strong>${data.remaining}</strong></div></div><section class="burndown"><div class="burndown-heading"><h3>Gráfico Burndown</h3><div class="legend"><span class="legend-ideal"></span>Línea ideal<span class="legend-real"></span>Puntos restantes</div></div>${!data.committed ? '<section class="empty"><h2>Sin datos para graficar</h2><p>Selecciona historias estimadas para el sprint.</p></section>' : burndownChart(data)}${data.sprint.status === 'En planificación' && data.committed ? '<p class="muted">El sprint aún no inicia. La línea de puntos restantes aparecerá al iniciarlo.</p>' : ''}</section><section class="burndown velocity"><div class="burndown-heading"><h3>Velocidad del equipo</h3><div class="legend"><span class="legend-committed"></span>Comprometidos<span class="legend-completed"></span>Completados</div></div>${velocity.sprints.length ? `${velocityChart(velocity)}<p class="muted">Promedio de velocidad: <strong>${velocity.average}</strong> puntos por sprint en ${velocity.sprints.length} ${velocity.sprints.length === 1 ? 'sprint cerrado' : 'sprints cerrados'}.</p>` : '<section class="empty"><h2>Aún no hay datos de velocidad</h2><p>La velocidad se calcula con los sprints cerrados del proyecto.</p></section>'}</section><div class="story-actions"><button id="back-metrics" class="quiet">${from === 'board' ? 'Volver al tablero' : 'Volver a sprints'}</button></div>`);
    modal.classList.add('board-modal');
    document.querySelector('#back-metrics').onclick = () => { clearInterval(boardTimer); return from === 'board' ? boardDialog(project) : sprintsDialog(project); };
    clearInterval(boardTimer);
    if (data.sprint.status !== 'Activo') return;
    const initial = await api(`/projects/${project.id}/board/version`);
    boardTimer = setInterval(async () => {
      if (!modal.open || !document.querySelector('.burndown-chart')) return clearInterval(boardTimer);
      try {
        const current = await api(`/projects/${project.id}/board/version`);
        if (current.sprintId !== initial.sprintId || current.version !== initial.version) {
          clearInterval(boardTimer);
          await burndownDialog(project, sprintId, from);
        }
      } catch { clearInterval(boardTimer); }
    }, 4000);
  } catch (error) { flash(error.message); }
}
if (new URLSearchParams(location.search).has('invitation')) authView('activate');
else load().catch(() => authView());
