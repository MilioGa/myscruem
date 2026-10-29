const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const notice = document.querySelector('#notice');
let state = { page: 'projects', filter: 'active', query: '', projects: [], users: [], owners: [] };
let timer;
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
  app.innerHTML = `<main class="auth"><aside class="intro"><img src="/logo.svg" alt="logo"><div><span class="eyebrow">UN ESPACIO PARA TU EQUIPO</span><h1>MySCruEm<span>.</span></h1><p>Grandes proyectos.<br>Un comienzo organizado.</p></div><small>Tu empresa, tu equipo, tus proyectos.</small></aside><section class="auth-panel"><div class="auth-form"><span class="eyebrow">BIENVENIDO A MY SCRUEM</span><h2>${mode === 'register' ? 'Registra tu empresa' : mode === 'activate' ? 'Activa tu cuenta' : 'Inicio de sesión'}</h2><p class="muted">${mode === 'register' ? 'Crea tu espacio de trabajo y tu cuenta de administrador.' : mode === 'activate' ? 'Elige una contraseña para empezar a trabajar con tu equipo.' : 'Accede al espacio de trabajo de tu empresa.'}</p><form id="auth-form">
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
  if (state.page === 'users' && state.user.role !== 'Administrador') state.page = 'projects';
  render();
}
function render() {
  const isAdmin = state.user.role === 'Administrador';
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><img src="/logo.svg" alt="logo"><strong>MySCruEm</strong></div><div class="workspace"><small>EMPRESA</small><strong>${escape(state.company.name)}</strong><span>${escape(state.company.code)}</span></div><nav aria-label="Navegación principal"><button data-page="projects" class="${state.page === 'projects' ? 'selected' : ''}"><span>▦</span> Proyectos</button>${isAdmin ? `<button data-page="users" class="${state.page === 'users' ? 'selected' : ''}"><span>♧</span> Usuarios y roles</button>` : ''}</nav><div class="sidebar-bottom"><span class="status-dot"></span> Espacio de trabajo</div></aside><div class="main"><header><span class="breadcrumb">${escape(state.company.name)} <span>/</span> ${state.page === 'users' ? 'Administración' : 'Proyectos'}</span><div class="account"><div class="avatar">${escape(state.user.name.slice(0, 1).toUpperCase())}</div><div><strong>${escape(state.user.name)}</strong><small>${escape(state.user.role)}</small></div><button id="logout" class="quiet">Salir</button></div></header><main class="content"><div class="page-heading"><div><span class="eyebrow">ESPACIO DE TRABAJO</span><h1>${state.page === 'users' ? 'Usuarios y roles' : 'Tus proyectos'}</h1><p class="muted">${state.page === 'users' ? 'Administra los accesos y las responsabilidades de tu empresa.' : 'Un lugar para organizar cada nuevo producto.'}</p></div>${state.page === 'users' ? '<button id="new-user" class="primary">+ Invitar usuario</button>' : state.user.role === 'Product Owner' ? '<button id="new-project" class="primary">+ Nuevo proyecto</button>' : ''}</div><div id="page-content"></div></main></div></div>`;
  document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => { state.page = button.dataset.page; state.query = ''; render(); });
  document.querySelector('#logout').onclick = async () => {
    try { await api('/logout', 'POST'); state = { page: 'projects', filter: 'active', query: '' }; authView(); }
    catch (error) { flash(error.message); }
  };
  document.querySelector('#new-user')?.addEventListener('click', () => userDialog());
  document.querySelector('#new-project')?.addEventListener('click', () => projectDialog());
  renderContent();
}
function renderContent() {
  const users = state.page === 'users';
  const source = users ? state.users : state.projects;
  const items = source.filter(item => (users || (state.filter === 'archived' ? item.archived : !item.archived)) && `${item.name} ${item.email || item.description}`.toLowerCase().includes(state.query.toLowerCase()));
  const target = document.querySelector('#page-content');
  target.innerHTML = `<div class="toolbar">${users ? `<span>${state.users.length} usuarios en la empresa</span>` : `<div class="tabs"><button data-filter="active" class="${state.filter === 'active' ? 'active' : ''}">Activos <span>${state.projects.filter(p => !p.archived).length}</span></button><button data-filter="archived" class="${state.filter === 'archived' ? 'active' : ''}">Archivados <span>${state.projects.filter(p => p.archived).length}</span></button></div>`}<input id="search" aria-label="${users ? 'Buscar usuarios' : 'Buscar proyectos'}" placeholder="${users ? 'Buscar por nombre o correo…' : 'Buscar proyectos…'}" value="${escape(state.query)}"></div>
  ${!items.length ? `<section class="empty"><div class="empty-icon">${users ? '♧' : '▦'}</div><h2>${state.query ? 'No encontramos coincidencias' : users ? 'No hay usuarios' : state.filter === 'archived' ? 'No hay proyectos archivados' : 'Aquí comienza tu próximo proyecto'}</h2><p>${state.query ? 'Prueba con otro nombre.' : users ? 'Invita a una persona para empezar.' : state.filter === 'archived' ? 'Los proyectos que archives seguirán disponibles aquí.' : state.user.role === 'Product Owner' ? 'Crea tu primer proyecto y dale un espacio a tus ideas.' : state.user.role === 'Administrador' ? 'Invita a un Product Owner para que cree el primer proyecto.' : 'Los proyectos de tu empresa aparecerán aquí.'}</p></section>` : users ? `<div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${items.map(user => `<tr><td><strong>${escape(user.name)}</strong><small>${escape(user.email)}</small></td><td>${escape(user.role)}</td><td>${badge(user.status, user.status === 'Activo' ? 'green' : '')}</td><td><button class="quiet" data-user="${user.id}">Editar</button>${user.status === 'Pendiente' ? `<button class="quiet" data-invite="${user.id}">Invitación</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="project-grid">${items.map(p => `<article class="project-card"><div class="card-top"><div class="project-icon">▦</div>${badge(p.archived ? 'Archivado' : 'Activo', p.archived ? '' : 'green')}</div><h2>${escape(p.name)}</h2><p>${escape(p.description)}</p><div class="project-owner"><div class="avatar">${escape(p.owner.slice(0, 1))}</div><div><small>PRODUCT OWNER</small><strong>${escape(p.owner)}</strong></div></div><div class="card-footer"><small>${new Date(p.created_at + 'Z').toLocaleDateString('es-MX')}</small><div><button class="quiet" data-sprints="${p.id}">Sprints</button><button class="quiet" data-backlog="${p.id}">Historias</button><button class="quiet" data-project="${p.id}">Ver proyecto →</button></div></div></article>`).join('')}</div>`}`;
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
  document.querySelectorAll('[data-backlog]').forEach(button => button.onclick = () => storiesDialog(state.projects.find(p => p.id === Number(button.dataset.backlog))));
  document.querySelectorAll('[data-sprints]').forEach(button => button.onclick = () => sprintsDialog(state.projects.find(p => p.id === Number(button.dataset.sprints))));
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
    const stories = await api(`/projects/${project.id}/stories`);
    const canCreate = !project.archived && state.user.role === 'Product Owner' && project.owner_id === state.user.id;
    dialog('Historias de usuario', `<p class="muted">${escape(project.name)} · ${stories.length} ${stories.length === 1 ? 'historia' : 'historias'}</p>${canCreate ? '<button id="new-story" class="primary">+ Nueva historia</button>' : ''}${stories.length ? `<div class="story-list">${stories.map(story => `<article class="story" data-story="${story.id}" draggable="${canCreate}"><div class="story-toolbar"><small>HU-${story.id}</small>${canCreate ? `<div><button class="quiet" data-move="${story.id}" data-direction="-1" aria-label="Subir ${escape(story.title)}" ${stories[0].id === story.id ? 'disabled' : ''}>↑</button><button class="quiet" data-move="${story.id}" data-direction="1" aria-label="Bajar ${escape(story.title)}" ${stories.at(-1).id === story.id ? 'disabled' : ''}>↓</button></div>` : ''}</div><div class="story-priority">${canCreate ? `<select aria-label="Prioridad de ${escape(story.title)}" data-priority="${story.id}">${['Must have','Should have','Could have','Won’t have'].map(priority => `<option ${story.priority === priority ? 'selected' : ''}>${priority}</option>`).join('')}</select>` : badge(story.priority)}</div><h3>${escape(story.title)}</h3><p>Como ${escape(story.actor)}, quiero ${escape(story.goal)}, para ${escape(story.benefit)}.</p><div class="story-points"><span>Puntos de historia</span>${state.user.role === 'Developer' && !project.archived ? `<select aria-label="Puntos de ${escape(story.title)}" data-estimate="${story.id}"><option value="" disabled ${story.points == null ? 'selected' : ''}>Sin estimar</option>${[1,2,3,5,8,13,21].map(points => `<option value="${points}" ${story.points === points ? 'selected' : ''}>${points}</option>`).join('')}</select>` : `<strong>${story.points ?? 'Sin estimar'}</strong>`}</div><strong>Criterios de aceptación</strong><ul>${story.criteria.map(criterion => `<li>${escape(criterion)}</li>`).join('')}</ul></article>`).join('')}</div>` : '<p class="muted">Este proyecto todavía no tiene historias de usuario.</p>'}`);
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
    if (canCreate) {
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
    dialog('Sprints del proyecto', `<p class="muted">${escape(project.name)}</p>${state.user.role === 'Scrum Master' && !project.archived ? '<button id="new-sprint" class="primary">+ Nuevo sprint</button>' : ''}${sprints.length ? `<div class="story-list">${sprints.map(sprint => `<article class="story"><h3>${escape(sprint.name)}</h3>${badge(sprint.status)}<p>${escape(sprint.start_date)} al ${escape(sprint.end_date)}</p><p class="project-description">${escape(sprint.goal)}</p><button class="quiet" data-plan="${sprint.id}">${state.user.role === 'Developer' && !project.archived && sprint.status === 'En planificación' ? 'Planificar' : 'Ver historias'}</button></article>`).join('')}</div>` : '<p class="muted">Este proyecto todavía no tiene sprints.</p>'}`);
    document.querySelector('#new-sprint')?.addEventListener('click', () => sprintForm(project));
    document.querySelectorAll('[data-plan]').forEach(button => button.onclick = () => planningDialog(project, sprints.find(sprint => sprint.id === Number(button.dataset.plan))));
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
if (new URLSearchParams(location.search).has('invitation')) authView('activate');
else load().catch(() => authView());
