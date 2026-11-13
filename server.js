import express from 'express';
import helmet from 'helmet';
import nodemailer from 'nodemailer';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const roles = ['Administrador', 'Product Owner', 'Scrum Master', 'Developer'];
const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('hex');
const passwordHash = value => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
};
const verify = (value, stored) => {
  const [salt, key] = stored.split(':');
  return timingSafeEqual(scryptSync(value, salt, 64), Buffer.from(key, 'hex'));
};
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, label, max = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label}: completa el campo (máximo ${max} caracteres).`);
  return value.trim();
};
const email = value => {
  const result = text(value, 'Correo', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail('Escribe un correo válido.');
  return result;
};
const password = value => {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) fail('La contraseña debe tener entre 10 y 128 caracteres.');
  return value;
};

export function createApp({ dbPath = process.env.DB_PATH || join(root, 'data', 'myscruem.sqlite'), sessionMs = 30 * 60 * 1000, now = () => new Date() } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), name TEXT NOT NULL, email TEXT NOT NULL, password TEXT, role TEXT NOT NULL, status TEXT NOT NULL, UNIQUE(company_id,email));
    CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), name TEXT NOT NULL, description TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id), archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS stories (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), title TEXT NOT NULL, actor TEXT NOT NULL, goal TEXT NOT NULL, benefit TEXT NOT NULL, criteria TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  if (!db.prepare('PRAGMA table_info(stories)').all().some(column => column.name === 'points')) {
    db.exec('ALTER TABLE stories ADD COLUMN points INTEGER CHECK(points IN (1,2,3,5,8,13,21))');
  }
  const storyColumns = db.prepare('PRAGMA table_info(stories)').all().map(column => column.name);
  if (!storyColumns.includes('priority')) db.exec("ALTER TABLE stories ADD COLUMN priority TEXT NOT NULL DEFAULT 'Must have' CHECK(priority IN ('Must have','Should have','Could have','Won’t have'))");
  if (!storyColumns.includes('position')) {
    db.exec('ALTER TABLE stories ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE stories SET position=id');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS sprints (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'En planificación' CHECK(status IN ('En planificación','Activo','Cerrado')));
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_sprint ON sprints(project_id) WHERE status='Activo';
  `);
  db.exec('CREATE TABLE IF NOT EXISTS sprint_stories (sprint_id INTEGER NOT NULL REFERENCES sprints(id), story_id INTEGER NOT NULL UNIQUE REFERENCES stories(id), PRIMARY KEY(sprint_id,story_id))');
  const sprintColumns = db.prepare('PRAGMA table_info(sprints)').all().map(column => column.name);
  for (const [name, type] of [['started_at', 'TEXT'], ['closed_at', 'TEXT'], ['committed_points', 'INTEGER'], ['completed_points', 'INTEGER'], ['board_version', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!sprintColumns.includes(name)) db.exec(`ALTER TABLE sprints ADD COLUMN ${name} ${type}`);
  }
  if (!db.prepare('PRAGMA table_info(sprint_stories)').all().some(column => column.name === 'completed')) {
    db.exec('ALTER TABLE sprint_stories ADD COLUMN completed INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, sprint_id INTEGER NOT NULL REFERENCES sprints(id), story_id INTEGER NOT NULL REFERENCES stories(id), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', assignee_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'Por hacer' CHECK(status IN ('Por hacer','En curso','En revisión','Terminado')), position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), name TEXT NOT NULL, project_id INTEGER REFERENCES projects(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id,name));
    CREATE UNIQUE INDEX IF NOT EXISTS team_per_project ON teams(project_id) WHERE project_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS team_members (team_id INTEGER NOT NULL REFERENCES teams(id), user_id INTEGER NOT NULL REFERENCES users(id), PRIMARY KEY(team_id,user_id));
  `);
  db.exec('CREATE TABLE IF NOT EXISTS epics (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id,name))');
  if (!db.prepare('PRAGMA table_info(stories)').all().some(column => column.name === 'epic_id')) db.exec('ALTER TABLE stories ADD COLUMN epic_id INTEGER REFERENCES epics(id)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS impediments (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id), description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Abierto' CHECK(status IN ('Abierto','Cerrado')), reported_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, solution TEXT, closed_by INTEGER REFERENCES users(id), closed_at TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_impediment ON impediments(task_id) WHERE status='Abierto';
  `);
  db.exec('CREATE TABLE IF NOT EXISTS definition_of_done (project_id INTEGER PRIMARY KEY REFERENCES projects(id), criteria TEXT NOT NULL, updated_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), actor_id INTEGER REFERENCES users(id), project_id INTEGER REFERENCES projects(id), task_id INTEGER REFERENCES tasks(id), kind TEXT NOT NULL, message TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS notifications_by_user ON notifications(user_id,read,id);
  `);
  db.exec('CREATE TABLE IF NOT EXISTS burndown (sprint_id INTEGER NOT NULL REFERENCES sprints(id), day TEXT NOT NULL, remaining INTEGER NOT NULL, PRIMARY KEY(sprint_id,day))');
  db.exec('CREATE INDEX IF NOT EXISTS tasks_by_sprint ON tasks(sprint_id,position,id)');
  const columns = ['Por hacer', 'En curso', 'En revisión', 'Terminado'];
  const taskTypes = ['Desarrollo', 'Pruebas', 'Diseño', 'Documentación'];
  const taskColumns = db.prepare('PRAGMA table_info(tasks)').all().map(column => column.name);
  if (!taskColumns.includes('label')) db.exec("ALTER TABLE tasks ADD COLUMN label TEXT NOT NULL DEFAULT ''");
  if (!taskColumns.includes('type')) db.exec("ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'Desarrollo'");
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '20kb' }));
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const transaction = fn => {
    db.exec('BEGIN');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const attempts = new Map();
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') && req.get('origin') !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Origen no permitido.' });
    next();
  });
  const limit = (req, res, next) => {
    const now = Date.now();
    for (const [key, item] of attempts) if (item.until < now) attempts.delete(key);
    const key = req.ip;
    const item = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    item.count++;
    attempts.set(key, item);
    if (item.count > 40) return res.status(429).json({ error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' });
    next();
  };
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' };
  const session = (res, userId) => {
    const token = secret();
    run('DELETE FROM sessions WHERE expires < ?', Date.now());
    run('INSERT INTO sessions VALUES (?,?,?,?)', hash(token), userId, secret(), Date.now() + sessionMs);
    res.cookie('sid', token, cookieOptions);
  };
  const auth = (req, res, next) => {
    const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid='))?.slice(4) || '';
    const current = get('SELECT s.id AS sid,s.csrf,s.expires,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?', hash(token));
    if (!current || current.expires < Date.now() || current.status !== 'Activo') return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    if (!['GET', 'HEAD'].includes(req.method) && req.get('x-csrf-token') !== current.csrf) return res.status(403).json({ error: 'Sesión no válida. Recarga la página.' });
    run('UPDATE sessions SET expires=? WHERE id=?', Date.now() + sessionMs, current.sid);
    req.user = current;
    next();
  };
  const admin = (req, res, next) => req.user.role === 'Administrador' ? next() : res.status(403).json({ error: 'Se requiere el rol Administrador.' });
  const projectFor = req => {
    const p = get('SELECT * FROM projects WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
    if (!p) fail('Proyecto no encontrado.', 404);
    return p;
  };
  app.post('/api/register', limit, (req, res) => {
    const name = text(req.body.company, 'Empresa');
    const code = text(req.body.code, 'Código', 40).toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(code)) fail('El código debe tener de 3 a 40 letras minúsculas, números o guiones.');
    const userName = text(req.body.name, 'Nombre');
    const userEmail = email(req.body.email);
    const pass = passwordHash(password(req.body.password));
    if (get('SELECT id FROM companies WHERE code=?', code)) fail('Este código de empresa ya está registrado.', 409);
    const id = transaction(() => {
      const company = run('INSERT INTO companies(name,code) VALUES (?,?)', name, code).lastInsertRowid;
      return Number(run('INSERT INTO users(company_id,name,email,password,role,status) VALUES (?,?,?,?,?,?)', company, userName, userEmail, pass, 'Administrador', 'Activo').lastInsertRowid);
    });
    session(res, id);
    res.status(201).json({ ok: true });
  });
  app.post('/api/login', limit, (req, res) => {
    const code = typeof req.body.code === 'string' ? req.body.code.trim().toLowerCase() : '';
    const address = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const user = get('SELECT u.* FROM users u JOIN companies c ON c.id=u.company_id WHERE c.code=? AND u.email=?', code, address);
    const supplied = typeof req.body.password === 'string' && req.body.password.length <= 128 ? req.body.password : '';
    const valid = verify(supplied, user?.password || `dummy:${'00'.repeat(64)}`);
    if (!valid || user?.status !== 'Activo') fail('Empresa, correo o contraseña incorrectos.', 401);
    session(res, user.id);
    res.json({ ok: true });
  });
  app.post('/api/activate', limit, (req, res) => {
    const token = text(req.body.token, 'Invitación', 100);
    const pass = passwordHash(password(req.body.password));
    const invitation = get('SELECT i.*,u.status FROM invitations i JOIN users u ON u.id=i.user_id WHERE i.id=?', hash(token));
    if (!invitation || invitation.expires < Date.now() || invitation.status !== 'Pendiente') fail('La invitación no es válida o ha caducado.');
    transaction(() => {
      run('UPDATE users SET password=?,status=? WHERE id=?', pass, 'Activo', invitation.user_id);
      run('DELETE FROM invitations WHERE user_id=?', invitation.user_id);
    });
    res.json({ ok: true });
  });
  app.get('/api/me', auth, (req, res) => {
    const { id, name, email, role, company_id, csrf } = req.user;
    res.json({ user: { id, name, email, role }, company: get('SELECT * FROM companies WHERE id=?', company_id), csrf });
  });
  app.post('/api/logout', auth, (req, res) => {
    run('DELETE FROM sessions WHERE id=?', req.user.sid);
    res.clearCookie('sid', cookieOptions).json({ ok: true });
  });
  app.get('/api/users', auth, admin, (req, res) => res.json(all('SELECT id,name,email,role,status FROM users WHERE company_id=? ORDER BY name', req.user.company_id)));
  app.post('/api/users', auth, admin, (req, res) => {
    const name = text(req.body.name, 'Nombre');
    const address = email(req.body.email);
    if (!roles.includes(req.body.role)) fail('Selecciona un rol válido.');
    if (get('SELECT id FROM users WHERE company_id=? AND email=?', req.user.company_id, address)) fail('Ya existe un usuario con ese correo.', 409);
    const id = Number(run('INSERT INTO users(company_id,name,email,role,status) VALUES (?,?,?,?,?)', req.user.company_id, name, address, req.body.role, 'Pendiente').lastInsertRowid);
    res.status(201).json({ id });
  });
  app.post('/api/users/:id/invitation', auth, admin, async (req, res) => {
    const user = get('SELECT * FROM users WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
    if (!user) fail('Usuario no encontrado.', 404);
    if (user.status !== 'Pendiente') fail('Solo se puede invitar a usuarios pendientes.');
    const token = secret();
    run('INSERT OR REPLACE INTO invitations VALUES (?,?,?)', hash(token), user.id, Date.now() + 48 * 60 * 60 * 1000);
    const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const url = `${base}/?invitation=${token}`;
    let sent = false;
    if (process.env.SMTP_HOST) {
      try {
        const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
        await transport.sendMail({ from: process.env.SMTP_FROM, to: user.email, subject: 'Activa tu cuenta de MySCruEm', text: `Hola ${user.name}, activa tu cuenta: ${url}\nEl enlace caduca en 48 horas.` });
        sent = true;
      } catch { sent = false; }
    }
    res.json({ url, sent });
  });
  app.patch('/api/users/:id', auth, admin, (req, res) => {
    const user = get('SELECT * FROM users WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
    if (!user) fail('Usuario no encontrado.', 404);
    const name = text(req.body.name, 'Nombre');
    const address = email(req.body.email);
    const { role, status } = req.body;
    if (!roles.includes(role) || !['Activo', 'Inactivo', 'Pendiente'].includes(status)) fail('Rol o estado no válido.');
    if (!user.password && status === 'Activo') fail('El usuario debe activar su cuenta mediante una invitación.');
    if (user.password && status === 'Pendiente') fail('La cuenta ya fue activada.');
    if (user.id === req.user.id && (role !== 'Administrador' || status !== 'Activo')) fail('No puedes desactivar tu cuenta ni quitarte el rol Administrador.');
    if (get('SELECT id FROM users WHERE company_id=? AND email=? AND id<>?', req.user.company_id, address, user.id)) fail('El correo ya está registrado.', 409);
    if ((role !== 'Product Owner' || status !== 'Activo') && get('SELECT id FROM projects WHERE owner_id=? AND archived=0', user.id)) fail('Reasigna o archiva sus proyectos activos antes de cambiar el rol o desactivar al Product Owner.');
    transaction(() => {
      run('UPDATE users SET name=?,email=?,role=?,status=? WHERE id=?', name, address, role, status, user.id);
      if (status !== 'Activo' || role !== user.role) run('DELETE FROM sessions WHERE user_id=?', user.id);
      if (status !== 'Pendiente' || address !== user.email) run('DELETE FROM invitations WHERE user_id=?', user.id);
    });
    res.json({ ok: true });
  });
  app.get('/api/owners', auth, (req, res) => res.json(all("SELECT id,name FROM users WHERE company_id=? AND role='Product Owner' AND status='Activo'", req.user.company_id)));
  app.get('/api/projects', auth, (req, res) => res.json(all('SELECT p.*,u.name AS owner FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.company_id=? ORDER BY p.id DESC', req.user.company_id)));
  app.post('/api/projects', auth, (req, res) => {
    if (req.user.role !== 'Product Owner') fail('Solo un Product Owner puede crear proyectos.', 403);
    const name = text(req.body.name, 'Nombre');
    const description = text(req.body.description, 'Descripción', 2000);
    const id = Number(run('INSERT INTO projects(company_id,name,description,owner_id) VALUES (?,?,?,?)', req.user.company_id, name, description, req.user.id).lastInsertRowid);
    res.status(201).json({ id });
  });
  app.patch('/api/projects/:id', auth, (req, res) => {
    const p = projectFor(req);
    if (req.user.role !== 'Product Owner' || p.owner_id !== req.user.id) fail('Solo el Product Owner de este proyecto puede modificarlo.', 403);
    const name = text(req.body.name, 'Nombre');
    const description = text(req.body.description, 'Descripción', 2000);
    if (typeof req.body.archived !== 'boolean') fail('Estado no válido.');
    run('UPDATE projects SET name=?,description=?,archived=? WHERE id=?', name, description, Number(req.body.archived), p.id);
    res.json({ ok: true });
  });
  app.patch('/api/projects/:id/owner', auth, admin, (req, res) => {
    const p = projectFor(req);
    const owner = get("SELECT id FROM users WHERE id=? AND company_id=? AND role='Product Owner' AND status='Activo'", Number(req.body.ownerId) || 0, req.user.company_id);
    if (!owner) fail('Selecciona un Product Owner activo de la empresa.');
    run('UPDATE projects SET owner_id=? WHERE id=?', owner.id, p.id);
    res.json({ ok: true });
  });
  app.get('/api/projects/:id/stories', auth, (req, res) => {
    const project = projectFor(req);
    const stories = all('SELECT stories.*,sprint_stories.sprint_id FROM stories LEFT JOIN sprint_stories ON sprint_stories.story_id=stories.id WHERE stories.project_id=? ORDER BY position,id', project.id);
    res.json(stories.map(story => ({ ...story, criteria: JSON.parse(story.criteria) })));
  });
  app.post('/api/projects/:id/stories', auth, (req, res) => {
    const project = projectFor(req);
    if (req.user.role !== 'Product Owner' || project.owner_id !== req.user.id) fail('Solo el Product Owner de este proyecto puede crear historias.', 403);
    if (project.archived) fail('No se pueden agregar historias a un proyecto archivado.');
    const title = text(req.body.title, 'Título');
    const actor = text(req.body.actor, 'Como', 300);
    const goal = text(req.body.goal, 'Quiero', 1000);
    const benefit = text(req.body.benefit, 'Para', 1000);
    if (!Array.isArray(req.body.criteria) || !req.body.criteria.length || req.body.criteria.length > 20) fail('Agrega entre 1 y 20 criterios de aceptación.');
    const criteria = req.body.criteria.map(value => text(value, 'Criterio de aceptación', 1000));
    const position = get('SELECT COALESCE(MAX(position),0)+1 AS next FROM stories WHERE project_id=?', project.id).next;
    const id = Number(run('INSERT INTO stories(project_id,title,actor,goal,benefit,criteria,position) VALUES (?,?,?,?,?,?,?)', project.id, title, actor, goal, benefit, JSON.stringify(criteria), position).lastInsertRowid);
    res.status(201).json({ id });
  });
  app.patch('/api/projects/:id/stories/:storyId/estimate', auth, (req, res) => {
    const project = projectFor(req);
    if (req.user.role !== 'Developer') fail('Solo un Developer puede estimar historias.', 403);
    if (project.archived) fail('No se pueden estimar historias de un proyecto archivado.');
    if (!get('SELECT id FROM stories WHERE id=? AND project_id=?', req.params.storyId, project.id)) fail('Historia no encontrada.', 404);
    if (![1, 2, 3, 5, 8, 13, 21].includes(req.body.points)) fail('Selecciona 1, 2, 3, 5, 8, 13 o 21 puntos.');
    if (req.body.points > 13 && get('SELECT story_id FROM sprint_stories WHERE story_id=?', req.params.storyId)) fail('Una historia comprometida no puede superar 13 puntos.');
    run('UPDATE stories SET points=? WHERE id=?', req.body.points, req.params.storyId);
    res.json({ ok: true });
  });
  app.patch('/api/projects/:id/stories/order', auth, (req, res) => {
    const project = projectFor(req);
    if (req.user.role !== 'Product Owner' || project.owner_id !== req.user.id) fail('Solo el Product Owner del proyecto puede ordenar el backlog.', 403);
    if (project.archived) fail('El proyecto está archivado.');
    const ids = all('SELECT id FROM stories WHERE project_id=?', project.id).map(story => story.id);
    const order = req.body.order;
    if (!Array.isArray(order) || order.length !== ids.length || new Set(order).size !== ids.length || order.some(id => !ids.includes(id))) fail('La lista de historias cambió. Actualiza el backlog.', 409);
    transaction(() => order.forEach((id, index) => run('UPDATE stories SET position=? WHERE id=? AND project_id=?', index + 1, id, project.id)));
    res.json({ ok: true });
  });
  app.patch('/api/projects/:id/stories/:storyId/priority', auth, (req, res) => {
    const project = projectFor(req);
    if (req.user.role !== 'Product Owner' || project.owner_id !== req.user.id) fail('Solo el Product Owner del proyecto puede cambiar prioridades.', 403);
    if (project.archived) fail('El proyecto está archivado.');
    if (!get('SELECT id FROM stories WHERE id=? AND project_id=?', req.params.storyId, project.id)) fail('Historia no encontrada.', 404);
    if (!['Must have', 'Should have', 'Could have', 'Won’t have'].includes(req.body.priority)) fail('Selecciona una prioridad MoSCoW válida.');
    run('UPDATE stories SET priority=? WHERE id=?', req.body.priority, req.params.storyId);
    res.json({ ok: true });
  });
  app.get('/api/projects/:id/sprints', auth, (req, res) => {
    const project = projectFor(req);
    res.json(all('SELECT * FROM sprints WHERE project_id=? ORDER BY start_date DESC,id DESC', project.id));
  });
  app.post('/api/projects/:id/sprints', auth, (req, res) => {
    const project = projectFor(req);
    if (req.user.role !== 'Scrum Master') fail('Solo un Scrum Master puede crear sprints.', 403);
    if (project.archived) fail('No se pueden crear sprints en un proyecto archivado.');
    const name = text(req.body.name, 'Nombre');
    const goal = text(req.body.goal, 'Meta del sprint', 2000);
    const start = req.body.startDate;
    const end = req.body.endDate;
    const validDate = value => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(value + 'T00:00:00Z');
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (!validDate(start) || !validDate(end) || end <= start) fail('La fecha final debe ser posterior a la inicial y ambas deben ser válidas.');
    const id = Number(run('INSERT INTO sprints(project_id,name,start_date,end_date,goal) VALUES (?,?,?,?,?)', project.id, name, start, end, goal).lastInsertRowid);
    res.status(201).json({ id });
  });
  const sprintFor = req => {
    const project = projectFor(req);
    const sprint = get('SELECT * FROM sprints WHERE id=? AND project_id=?', req.params.sprintId, project.id);
    if (!sprint) fail('Sprint no encontrado.', 404);
    return { project, sprint };
  };
  app.get('/api/projects/:id/sprints/:sprintId/stories', auth, (req, res) => {
    const { project, sprint } = sprintFor(req);
    const stories = all('SELECT stories.*,sprint_stories.completed FROM stories JOIN sprint_stories ON sprint_stories.story_id=stories.id WHERE sprint_stories.sprint_id=? AND stories.project_id=? ORDER BY position,id', sprint.id, project.id);
    res.json({ stories: stories.map(story => ({ ...story, criteria: JSON.parse(story.criteria) })), points: stories.reduce((sum, story) => sum + (story.points || 0), 0) });
  });
  const planningFor = req => {
    const current = sprintFor(req);
    if (req.user.role !== 'Developer') fail('Solo un Developer puede seleccionar historias.', 403);
    if (current.project.archived || current.sprint.status !== 'En planificación') fail('El sprint debe pertenecer a un proyecto activo y estar en planificación.');
    return current;
  };
  app.post('/api/projects/:id/sprints/:sprintId/stories', auth, (req, res) => {
    const { project, sprint } = planningFor(req);
    const story = get('SELECT * FROM stories WHERE id=? AND project_id=?', Number.isSafeInteger(req.body.storyId) ? req.body.storyId : 0, project.id);
    if (!story) fail('Historia no encontrada.', 404);
    if (!story.points || story.points > 13) fail('La historia debe estar estimada y no superar 13 puntos.');
    if (get('SELECT story_id FROM sprint_stories WHERE story_id=?', story.id)) fail('La historia ya está seleccionada en un sprint.', 409);
    run('INSERT INTO sprint_stories(sprint_id,story_id) VALUES (?,?)', sprint.id, story.id);
    res.status(201).json({ ok: true });
  });
  app.delete('/api/projects/:id/sprints/:sprintId/stories/:storyId', auth, (req, res) => {
    const { sprint } = planningFor(req);
    const removed = run('DELETE FROM sprint_stories WHERE sprint_id=? AND story_id=?', sprint.id, req.params.storyId);
    if (!removed.changes) fail('La historia no pertenece a este sprint.', 404);
    res.json({ ok: true });
  });
  const masterFor = req => {
    const current = sprintFor(req);
    if (req.user.role !== 'Scrum Master') fail('Solo un Scrum Master puede iniciar o cerrar sprints.', 403);
    if (current.project.archived) fail('El proyecto está archivado.');
    return current;
  };
  const today = () => {
    const date = now();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const recordBurndown = sprintId => {
    const sprint = get('SELECT committed_points FROM sprints WHERE id=?', sprintId);
    const completed = sprintPoints(sprintId).completed;
    run('INSERT INTO burndown(sprint_id,day,remaining) VALUES (?,?,?) ON CONFLICT(sprint_id,day) DO UPDATE SET remaining=excluded.remaining', sprintId, today(), Math.max((sprint.committed_points || 0) - completed, 0));
  };
  const sprintPoints = sprintId => get('SELECT COUNT(*) AS total, COALESCE(SUM(stories.points),0) AS points, COALESCE(SUM(CASE WHEN sprint_stories.completed=1 THEN stories.points ELSE 0 END),0) AS completed FROM sprint_stories JOIN stories ON stories.id=sprint_stories.story_id WHERE sprint_stories.sprint_id=?', sprintId);
  app.post('/api/projects/:id/sprints/:sprintId/start', auth, (req, res) => {
    const { project, sprint } = masterFor(req);
    if (sprint.status !== 'En planificación') fail('Solo se puede iniciar un sprint en planificación.');
    const committed = sprintPoints(sprint.id);
    if (!committed.total) fail('Selecciona al menos una historia antes de iniciar el sprint.');
    if (get("SELECT id FROM sprints WHERE project_id=? AND status='Activo'", project.id)) fail('El proyecto ya tiene un sprint activo.', 409);
    transaction(() => {
      run("UPDATE sprints SET status='Activo',started_at=?,committed_points=? WHERE id=?", now().toISOString(), committed.points, sprint.id);
      recordBurndown(sprint.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/projects/:id/sprints/:sprintId/close', auth, (req, res) => {
    const { sprint } = masterFor(req);
    if (sprint.status !== 'Activo') fail('Solo se puede cerrar un sprint activo.');
    const summary = transaction(() => {
      const points = sprintPoints(sprint.id);
      const committed = sprint.committed_points ?? points.points;
      recordBurndown(sprint.id);
      const returned = run('DELETE FROM sprint_stories WHERE sprint_id=? AND completed=0', sprint.id).changes;
      run("UPDATE sprints SET status='Cerrado',closed_at=?,committed_points=?,completed_points=? WHERE id=?", now().toISOString(), committed, points.completed, sprint.id);
      return { committed, completed: points.completed, returned: Number(returned) };
    });
    res.json(summary);
  });
  app.get('/api/projects/:id/sprints/:sprintId/burndown', auth, (req, res) => {
    const { sprint } = sprintFor(req);
    const points = sprintPoints(sprint.id);
    const committed = sprint.committed_points ?? points.points;
    const completed = sprint.status === 'Cerrado' ? sprint.completed_points ?? 0 : points.completed;
    const records = all('SELECT day,remaining FROM burndown WHERE sprint_id=? ORDER BY day', sprint.id);
    const dates = [];
    for (let day = new Date(sprint.start_date + 'T00:00:00Z'); day.toISOString().slice(0, 10) <= sprint.end_date; day.setUTCDate(day.getUTCDate() + 1)) dates.push(day.toISOString().slice(0, 10));
    const last = sprint.status === 'Activo' ? today() : sprint.status === 'Cerrado' ? (records.at(-1)?.day ?? sprint.end_date) : null;
    const days = dates.map((date, index) => {
      const ideal = Math.round(committed * (1 - index / Math.max(dates.length - 1, 1)) * 10) / 10;
      if (!last || date > last) return { date, ideal, remaining: null };
      const recorded = records.filter(record => record.day <= date || date === dates.at(-1)).at(-1);
      return { date, ideal, remaining: recorded ? recorded.remaining : committed };
    });
    res.json({ sprint: { id: sprint.id, name: sprint.name, status: sprint.status, start_date: sprint.start_date, end_date: sprint.end_date }, committed, completed, remaining: Math.max(committed - completed, 0), days });
  });
  const assignable = project => {
    const team = get('SELECT id FROM teams WHERE project_id=?', project.id);
    return team
      ? all("SELECT users.id,users.name FROM team_members JOIN users ON users.id=team_members.user_id WHERE team_members.team_id=? AND users.status='Activo' AND users.role='Developer' ORDER BY users.name", team.id)
      : all("SELECT id,name FROM users WHERE company_id=? AND status='Activo' AND role='Developer' ORDER BY name", project.company_id);
  };
  app.get('/api/projects/:id/board', auth, (req, res) => {
    const project = projectFor(req);
    const sprint = get("SELECT id,name,goal,start_date,end_date,status,committed_points,board_version FROM sprints WHERE project_id=? AND status='Activo'", project.id);
    if (!sprint) return res.json({ sprint: null, columns, stories: [], tasks: [], members: [], types: taskTypes, labels: [] });
    const stories = all('SELECT stories.id,stories.title,stories.points,sprint_stories.completed FROM sprint_stories JOIN stories ON stories.id=sprint_stories.story_id WHERE sprint_stories.sprint_id=? ORDER BY stories.position,stories.id', sprint.id);
    const filters = ['tasks.sprint_id=?'];
    const values = [sprint.id];
    if (req.query.assignee) { filters.push('tasks.assignee_id=?'); values.push(Number(req.query.assignee) || 0); }
    if (req.query.label) { filters.push('tasks.label=?'); values.push(String(req.query.label)); }
    if (req.query.type) { filters.push('tasks.type=?'); values.push(String(req.query.type)); }
    const tasks = all(`SELECT tasks.id,tasks.story_id,tasks.title,tasks.description,tasks.assignee_id,users.name AS assignee,tasks.status,tasks.position,tasks.label,tasks.type,impediments.id AS impediment_id,impediments.description AS impediment FROM tasks JOIN users ON users.id=tasks.assignee_id LEFT JOIN impediments ON impediments.task_id=tasks.id AND impediments.status='Abierto' WHERE ${filters.join(' AND ')} ORDER BY tasks.position,tasks.id`, ...values);
    const labels = all("SELECT DISTINCT label FROM tasks WHERE sprint_id=? AND label<>'' ORDER BY label", sprint.id).map(row => row.label);
    const members = assignable(project);
    res.json({ sprint, columns, stories, tasks, members, types: taskTypes, labels });
  });
  app.get('/api/projects/:id/board/version', auth, (req, res) => {
    const project = projectFor(req);
    const sprint = get("SELECT id,board_version FROM sprints WHERE project_id=? AND status='Activo'", project.id);
    res.json({ sprintId: sprint?.id ?? null, version: sprint?.board_version ?? 0 });
  });
  const notify = (userId, actor, projectId, taskId, kind, message) => {
    if (!userId || userId === actor.id) return;
    run('INSERT INTO notifications(user_id,actor_id,project_id,task_id,kind,message,created_at) VALUES (?,?,?,?,?,?,?)', userId, actor.id, projectId, taskId, kind, message, now().toISOString());
  };
  const activeTaskFor = req => {
    const project = projectFor(req);
    if (req.user.role !== 'Developer') fail('Solo un Developer puede modificar tareas del tablero.', 403);
    if (project.archived) fail('El proyecto está archivado.');
    const task = get("SELECT tasks.* FROM tasks JOIN sprints ON sprints.id=tasks.sprint_id WHERE tasks.id=? AND sprints.project_id=? AND sprints.status='Activo'", Number(req.params.taskId) || 0, project.id);
    if (!task) fail('Tarea no encontrada en el sprint activo.', 404);
    return task;
  };
  const refreshStory = (sprintId, storyId) => {
    const progress = get("SELECT COUNT(*) AS total, SUM(status='Terminado') AS done FROM tasks WHERE sprint_id=? AND story_id=?", sprintId, storyId);
    run('UPDATE sprint_stories SET completed=? WHERE sprint_id=? AND story_id=?', progress.total > 0 && progress.done === progress.total ? 1 : 0, sprintId, storyId);
  };
  app.post('/api/projects/:id/tasks', auth, (req, res) => {
    const project = projectFor(req);
    if (req.user.role !== 'Developer') fail('Solo un Developer puede crear tareas.', 403);
    if (project.archived) fail('El proyecto está archivado.');
    const sprint = get("SELECT id FROM sprints WHERE project_id=? AND status='Activo'", project.id);
    if (!sprint) fail('El proyecto no tiene un sprint activo.');
    const title = text(req.body.title, 'Título');
    const description = req.body.description === undefined || req.body.description === '' ? '' : text(req.body.description, 'Descripción', 1000);
    const label = req.body.label === undefined || req.body.label === '' ? '' : text(req.body.label, 'Etiqueta', 40);
    const type = req.body.type === undefined ? 'Desarrollo' : req.body.type;
    if (!taskTypes.includes(type)) fail('Selecciona un tipo de tarea válido.');
    const story = get('SELECT story_id FROM sprint_stories WHERE sprint_id=? AND story_id=?', sprint.id, Number.isSafeInteger(req.body.storyId) ? req.body.storyId : 0);
    if (!story) fail('Selecciona una historia del sprint activo.');
    const assignee = assignable(project).find(member => member.id === req.body.assigneeId);
    if (!assignee) fail('Selecciona un Developer activo del equipo del proyecto como responsable.');
    const id = transaction(() => {
      const position = get('SELECT COALESCE(MAX(position),0)+1 AS next FROM tasks WHERE sprint_id=?', sprint.id).next;
      const created = Number(run('INSERT INTO tasks(sprint_id,story_id,title,description,assignee_id,position,label,type) VALUES (?,?,?,?,?,?,?,?)', sprint.id, story.story_id, title, description, assignee.id, position, label, type).lastInsertRowid);
      notify(assignee.id, req.user, project.id, created, 'Asignación', `${req.user.name} te asignó la tarea "${title}" en ${project.name}.`);
      refreshStory(sprint.id, story.story_id);
      recordBurndown(sprint.id);
      run('UPDATE sprints SET board_version=board_version+1 WHERE id=?', sprint.id);
      return created;
    });
    res.status(201).json({ id });
  });
  app.patch('/api/projects/:id/tasks/:taskId/status', auth, (req, res) => {
    const task = activeTaskFor(req);
    if (!columns.includes(req.body.status)) fail('Selecciona una columna válida.');
    transaction(() => {
      const position = get('SELECT COALESCE(MAX(position),0)+1 AS next FROM tasks WHERE sprint_id=?', task.sprint_id).next;
      run('UPDATE tasks SET status=?,position=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', req.body.status, task.status === req.body.status ? task.position : position, task.id);
      if (task.status !== req.body.status) notify(task.assignee_id, req.user, get('SELECT project_id FROM sprints WHERE id=?', task.sprint_id).project_id, task.id, 'Cambio de estado', `${req.user.name} movió tu tarea "${task.title}" a ${req.body.status}.`);
      refreshStory(task.sprint_id, task.story_id);
      recordBurndown(task.sprint_id);
      run('UPDATE sprints SET board_version=board_version+1 WHERE id=?', task.sprint_id);
    });
    res.json({ ok: true });
  });
  const teamData = (req, existing) => {
    const name = text(req.body.name, 'Nombre del equipo');
    if (get('SELECT id FROM teams WHERE company_id=? AND name=? AND id<>?', req.user.company_id, name, existing?.id ?? 0)) fail('Ya existe un equipo con ese nombre.', 409);
    let projectId = null;
    if (req.body.projectId !== undefined && req.body.projectId !== null && req.body.projectId !== '') {
      const project = get('SELECT id FROM projects WHERE id=? AND company_id=?', Number.isSafeInteger(req.body.projectId) ? req.body.projectId : 0, req.user.company_id);
      if (!project) fail('Selecciona un proyecto de la empresa.');
      if (get('SELECT id FROM teams WHERE project_id=? AND id<>?', project.id, existing?.id ?? 0)) fail('El proyecto ya tiene un equipo asignado.', 409);
      projectId = project.id;
    }
    if (!Array.isArray(req.body.memberIds) || req.body.memberIds.length > 100) fail('Selecciona los integrantes del equipo.');
    const memberIds = [...new Set(req.body.memberIds)];
    for (const id of memberIds) {
      if (!Number.isSafeInteger(id) || !get("SELECT id FROM users WHERE id=? AND company_id=? AND role<>'Administrador' AND status<>'Inactivo'", id, req.user.company_id)) fail('Los integrantes deben ser usuarios activos o pendientes de la empresa.');
    }
    return { name, projectId, memberIds };
  };
  const saveMembers = (teamId, memberIds) => {
    run('DELETE FROM team_members WHERE team_id=?', teamId);
    for (const id of memberIds) run('INSERT INTO team_members(team_id,user_id) VALUES (?,?)', teamId, id);
  };
  app.get('/api/teams', auth, admin, (req, res) => {
    const teams = all('SELECT teams.id,teams.name,teams.project_id,projects.name AS project FROM teams LEFT JOIN projects ON projects.id=teams.project_id WHERE teams.company_id=? ORDER BY teams.name', req.user.company_id);
    const members = all('SELECT team_members.team_id,users.id,users.name,users.role FROM team_members JOIN users ON users.id=team_members.user_id JOIN teams ON teams.id=team_members.team_id WHERE teams.company_id=? ORDER BY users.name', req.user.company_id);
    res.json(teams.map(team => ({ ...team, members: members.filter(member => member.team_id === team.id).map(({ team_id, ...member }) => member) })));
  });
  app.post('/api/teams', auth, admin, (req, res) => {
    const data = teamData(req);
    const id = transaction(() => {
      const created = Number(run('INSERT INTO teams(company_id,name,project_id) VALUES (?,?,?)', req.user.company_id, data.name, data.projectId).lastInsertRowid);
      saveMembers(created, data.memberIds);
      return created;
    });
    res.status(201).json({ id });
  });
  app.patch('/api/teams/:id', auth, admin, (req, res) => {
    const team = get('SELECT * FROM teams WHERE id=? AND company_id=?', Number(req.params.id) || 0, req.user.company_id);
    if (!team) fail('Equipo no encontrado.', 404);
    const data = teamData(req, team);
    transaction(() => {
      run('UPDATE teams SET name=?,project_id=? WHERE id=?', data.name, data.projectId, team.id);
      saveMembers(team.id, data.memberIds);
    });
    res.json({ ok: true });
  });
  const epicOwner = req => {
    const project = projectFor(req);
    if (req.user.role !== 'Product Owner' || project.owner_id !== req.user.id) fail('Solo el Product Owner del proyecto puede gestionar épicas.', 403);
    if (project.archived) fail('El proyecto está archivado.');
    return project;
  };
  const epicData = (req, project, existing) => {
    const name = text(req.body.name, 'Nombre de la épica');
    const description = req.body.description === undefined || req.body.description === '' ? '' : text(req.body.description, 'Descripción', 1000);
    if (get('SELECT id FROM epics WHERE project_id=? AND name=? AND id<>?', project.id, name, existing?.id ?? 0)) fail('Ya existe una épica con ese nombre.', 409);
    return { name, description };
  };
  app.get('/api/projects/:id/epics', auth, (req, res) => {
    const project = projectFor(req);
    res.json(all('SELECT epics.id,epics.name,epics.description,COUNT(stories.id) AS stories,COALESCE(SUM(stories.points),0) AS points FROM epics LEFT JOIN stories ON stories.epic_id=epics.id WHERE epics.project_id=? GROUP BY epics.id ORDER BY epics.id', project.id));
  });
  app.post('/api/projects/:id/epics', auth, (req, res) => {
    const project = epicOwner(req);
    const data = epicData(req, project);
    res.status(201).json({ id: Number(run('INSERT INTO epics(project_id,name,description) VALUES (?,?,?)', project.id, data.name, data.description).lastInsertRowid) });
  });
  app.patch('/api/projects/:id/epics/:epicId', auth, (req, res) => {
    const project = epicOwner(req);
    const epic = get('SELECT * FROM epics WHERE id=? AND project_id=?', Number(req.params.epicId) || 0, project.id);
    if (!epic) fail('Épica no encontrada.', 404);
    const data = epicData(req, project, epic);
    run('UPDATE epics SET name=?,description=? WHERE id=?', data.name, data.description, epic.id);
    res.json({ ok: true });
  });
  app.patch('/api/projects/:id/stories/:storyId/epic', auth, (req, res) => {
    const project = epicOwner(req);
    const story = get('SELECT id FROM stories WHERE id=? AND project_id=?', Number(req.params.storyId) || 0, project.id);
    if (!story) fail('Historia no encontrada.', 404);
    let epicId = null;
    if (req.body.epicId !== null) {
      const epic = get('SELECT id FROM epics WHERE id=? AND project_id=?', Number.isSafeInteger(req.body.epicId) ? req.body.epicId : 0, project.id);
      if (!epic) fail('Selecciona una épica del proyecto.');
      epicId = epic.id;
    }
    run('UPDATE stories SET epic_id=? WHERE id=?', epicId, story.id);
    res.json({ ok: true });
  });
  app.get('/api/projects/:id/stories/:storyId/tasks', auth, (req, res) => {
    const project = projectFor(req);
    const story = get('SELECT id,title,points,epic_id FROM stories WHERE id=? AND project_id=?', Number(req.params.storyId) || 0, project.id);
    if (!story) fail('Historia no encontrada.', 404);
    const tasks = all('SELECT tasks.id,tasks.title,tasks.status,users.name AS assignee,sprints.name AS sprint FROM tasks JOIN users ON users.id=tasks.assignee_id JOIN sprints ON sprints.id=tasks.sprint_id WHERE tasks.story_id=? ORDER BY sprints.id,tasks.position,tasks.id', story.id);
    const done = tasks.filter(task => task.status === 'Terminado').length;
    res.json({ story, tasks, done, total: tasks.length, progress: tasks.length ? Math.round(done * 100 / tasks.length) : 0 });
  });
  app.post('/api/projects/:id/tasks/:taskId/impediments', auth, (req, res) => {
    const task = activeTaskFor(req);
    const description = text(req.body.description, 'Descripción del impedimento', 500);
    if (get("SELECT id FROM impediments WHERE task_id=? AND status='Abierto'", task.id)) fail('La tarea ya tiene un impedimento abierto.', 409);
    const id = transaction(() => {
      const created = Number(run('INSERT INTO impediments(task_id,description,reported_by,created_at) VALUES (?,?,?,?)', task.id, description, req.user.id, now().toISOString()).lastInsertRowid);
      run('UPDATE sprints SET board_version=board_version+1 WHERE id=?', task.sprint_id);
      return created;
    });
    res.status(201).json({ id });
  });
  app.get('/api/projects/:id/impediments', auth, (req, res) => {
    const project = projectFor(req);
    const status = req.query.status === 'Cerrado' ? 'Cerrado' : req.query.status === 'Todos' ? null : 'Abierto';
    res.json(all(`SELECT impediments.id,impediments.description,impediments.status,impediments.created_at,impediments.solution,impediments.closed_at,tasks.id AS task_id,tasks.title AS task,tasks.story_id,sprints.name AS sprint,reporter.name AS reported_by,closer.name AS closed_by FROM impediments JOIN tasks ON tasks.id=impediments.task_id JOIN sprints ON sprints.id=tasks.sprint_id JOIN users reporter ON reporter.id=impediments.reported_by LEFT JOIN users closer ON closer.id=impediments.closed_by WHERE sprints.project_id=? ${status ? 'AND impediments.status=?' : ''} ORDER BY impediments.id DESC`, project.id, ...(status ? [status] : [])));
  });
  app.post('/api/projects/:id/impediments/:impedimentId/close', auth, (req, res) => {
    const project = projectFor(req);
    if (req.user.role !== 'Scrum Master') fail('Solo un Scrum Master puede cerrar impedimentos.', 403);
    const impediment = get('SELECT impediments.*,tasks.sprint_id FROM impediments JOIN tasks ON tasks.id=impediments.task_id JOIN sprints ON sprints.id=tasks.sprint_id WHERE impediments.id=? AND sprints.project_id=?', Number(req.params.impedimentId) || 0, project.id);
    if (!impediment) fail('Impedimento no encontrado.', 404);
    if (impediment.status !== 'Abierto') fail('El impedimento ya está cerrado.');
    const solution = text(req.body.solution, 'Solución', 500);
    transaction(() => {
      run("UPDATE impediments SET status='Cerrado',solution=?,closed_by=?,closed_at=? WHERE id=?", solution, req.user.id, now().toISOString(), impediment.id);
      notify(impediment.reported_by, req.user, project.id, impediment.task_id, 'Impedimento', `${req.user.name} cerró el impedimento que registraste: ${solution}`);
      run('UPDATE sprints SET board_version=board_version+1 WHERE id=?', impediment.sprint_id);
    });
    res.json({ ok: true });
  });
  const training = {
    guide: JSON.parse(readFileSync(join(root, 'training', 'guia.json'), 'utf8')),
    glossary: JSON.parse(readFileSync(join(root, 'training', 'glosario.json'), 'utf8')).terms,
    infographics: [
      { title: 'Ciclo del sprint', src: '/capacitacion/ciclo-sprint.svg', alt: 'Ciclo del sprint: planificación, sprint con Daily, revisión y retrospectiva.' },
      { title: 'Tablero Kanban', src: '/capacitacion/tablero-kanban.svg', alt: 'Uso del tablero Kanban con sus cuatro columnas y tarjetas bloqueadas.' },
      { title: 'Gráfico Burndown', src: '/capacitacion/burndown.svg', alt: 'Lectura del gráfico Burndown: línea ideal frente a puntos restantes.' }
    ]
  };
  const plainText = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  app.get('/api/training', auth, (req, res) => res.json({ ...training.guide, infographics: training.infographics, terms: training.glossary.length }));
  app.get('/api/training/glossary', auth, (req, res) => {
    const query = plainText(typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '').trim();
    res.json(query ? training.glossary.filter(item => plainText(`${item.term} ${item.definition}`).includes(query)) : training.glossary);
  });
  app.get('/api/projects/:id/dod', auth, (req, res) => {
    const project = projectFor(req);
    const dod = get('SELECT definition_of_done.criteria,definition_of_done.updated_at,users.name AS updated_by FROM definition_of_done LEFT JOIN users ON users.id=definition_of_done.updated_by WHERE project_id=?', project.id);
    res.json(dod ? { criteria: JSON.parse(dod.criteria), updated_at: dod.updated_at, updated_by: dod.updated_by } : { criteria: [], updated_at: null, updated_by: null });
  });
  app.put('/api/projects/:id/dod', auth, (req, res) => {
    const project = projectFor(req);
    if (req.user.role !== 'Product Owner' || project.owner_id !== req.user.id) fail('Solo el Product Owner del proyecto puede definir la Definition of Done.', 403);
    if (project.archived) fail('El proyecto está archivado.');
    if (!Array.isArray(req.body.criteria) || req.body.criteria.length > 15) fail('La Definition of Done admite hasta 15 criterios.');
    const criteria = req.body.criteria.map(item => text(item, 'Criterio', 200));
    if (new Set(criteria.map(item => item.toLowerCase())).size !== criteria.length) fail('Los criterios no pueden repetirse.');
    run('INSERT INTO definition_of_done(project_id,criteria,updated_by,updated_at) VALUES (?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET criteria=excluded.criteria,updated_by=excluded.updated_by,updated_at=excluded.updated_at', project.id, JSON.stringify(criteria), req.user.id, now().toISOString());
    res.json({ criteria });
  });
  app.use(express.static(join(root, 'public')));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.status ? error.message : 'No fue posible completar la operación.' }));
  return { app, db };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { app } = createApp();
  app.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`MySCruEm: http://localhost:${process.env.PORT || 3000}`));
}
