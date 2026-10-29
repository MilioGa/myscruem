import express from 'express';
import helmet from 'helmet';
import nodemailer from 'nodemailer';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
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
  for (const [name, type] of [['started_at', 'TEXT'], ['closed_at', 'TEXT'], ['committed_points', 'INTEGER'], ['completed_points', 'INTEGER']]) {
    if (!sprintColumns.includes(name)) db.exec(`ALTER TABLE sprints ADD COLUMN ${name} ${type}`);
  }
  if (!db.prepare('PRAGMA table_info(sprint_stories)').all().some(column => column.name === 'completed')) {
    db.exec('ALTER TABLE sprint_stories ADD COLUMN completed INTEGER NOT NULL DEFAULT 0');
  }
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
  const sprintPoints = sprintId => get('SELECT COUNT(*) AS total, COALESCE(SUM(stories.points),0) AS points, COALESCE(SUM(CASE WHEN sprint_stories.completed=1 THEN stories.points ELSE 0 END),0) AS completed FROM sprint_stories JOIN stories ON stories.id=sprint_stories.story_id WHERE sprint_stories.sprint_id=?', sprintId);
  app.post('/api/projects/:id/sprints/:sprintId/start', auth, (req, res) => {
    const { project, sprint } = masterFor(req);
    if (sprint.status !== 'En planificación') fail('Solo se puede iniciar un sprint en planificación.');
    const committed = sprintPoints(sprint.id);
    if (!committed.total) fail('Selecciona al menos una historia antes de iniciar el sprint.');
    if (get("SELECT id FROM sprints WHERE project_id=? AND status='Activo'", project.id)) fail('El proyecto ya tiene un sprint activo.', 409);
    run("UPDATE sprints SET status='Activo',started_at=?,committed_points=? WHERE id=?", now().toISOString(), committed.points, sprint.id);
    res.json({ ok: true });
  });
  app.post('/api/projects/:id/sprints/:sprintId/close', auth, (req, res) => {
    const { sprint } = masterFor(req);
    if (sprint.status !== 'Activo') fail('Solo se puede cerrar un sprint activo.');
    const summary = transaction(() => {
      const points = sprintPoints(sprint.id);
      const committed = sprint.committed_points ?? points.points;
      const returned = run('DELETE FROM sprint_stories WHERE sprint_id=? AND completed=0', sprint.id).changes;
      run("UPDATE sprints SET status='Cerrado',closed_at=?,committed_points=?,completed_points=? WHERE id=?", now().toISOString(), committed, points.completed, sprint.id);
      return { committed, completed: points.completed, returned: Number(returned) };
    });
    res.json(summary);
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
