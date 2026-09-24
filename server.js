const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'development-only-secret-change-me';
const dataDirectory = process.env.DATA_DIR || __dirname;
const secureCookies = process.env.SECURE_COOKIES !== 'false' && process.env.NODE_ENV === 'production';
const allowedPriorities = new Set(['low', 'medium', 'high']);

fs.mkdirSync(dataDirectory, { recursive: true });
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: SESSION_SECRET,
    store: new SQLiteStore({ db: 'sessions.db', dir: dataDirectory }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8,
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
    },
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/dashboard');
  }
  next();
}

app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { error: 'Email va parol to\'ldirilishi kerak.' });
  }

  try {
    const user = await db.getUserByEmail(email.trim().toLowerCase());
    if (!user) {
      return res.render('login', { error: 'Bunday foydalanuvchi topilmadi.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.render('login', { error: 'Parol noto\'g\'ri.' });
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).render('login', { error: 'Serverda xatolik yuz berdi.' });
  }
});

app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.render('register', { error: 'Barcha maydonlarni to\'ldiring.' });
  }

  if (password.length < 6) {
    return res.render('register', { error: 'Parol kamida 6 ta belgidan iborat bo\'lishi kerak.' });
  }

  try {
    const existingUser = await db.getUserByEmail(email.trim().toLowerCase());
    if (existingUser) {
      return res.render('register', { error: 'Bu email allaqachon ro\'yxatdan o\'tgan.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = await db.createUser(name.trim(), email.trim().toLowerCase(), passwordHash, 'user');

    req.session.user = {
      id: userId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: 'user',
    };

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).render('register', { error: 'Ro\'yxatdan o\'tishda xatolik yuz berdi.' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const filter = ['all', 'pending', 'completed'].includes(req.query.filter) ? req.query.filter : 'all';
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 80) : '';
    const tasks = await db.getTasksByUserId(req.session.user.id, filter, search);
    const stats = await db.getTaskSummaryByUserId(req.session.user.id);
    res.render('dashboard', { tasks, stats, filter, search });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).send('Dashboard yuklashda xatolik bo\'ldi.');
  }
});

app.post('/tasks', requireAuth, async (req, res) => {
  const { title, description, priority, due_date } = req.body;

  if (!title || !title.trim()) {
    return res.redirect('/dashboard');
  }

  try {
    const safePriority = allowedPriorities.has(priority) ? priority : 'medium';
    await db.createTask(
      req.session.user.id,
      title.trim(),
      description ? description.trim() : '',
      safePriority,
      due_date || null
    );
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).send('Vazifa yaratishda xatolik yuz berdi.');
  }
});

app.get('/tasks/:id/edit', requireAuth, async (req, res) => {
  try {
    const task = await db.getTaskById(req.params.id);
    if (!task || task.user_id !== req.session.user.id) {
      return res.status(404).send('Vazifa topilmadi.');
    }
    res.render('edit-task', { task, error: null });
  } catch (error) {
    console.error('Edit task page error:', error);
    res.status(500).send('Vazifani tahrirlash sahifasi yuklanmadi.');
  }
});

app.post('/tasks/:id/edit', requireAuth, async (req, res) => {
  const { title, description, priority, due_date } = req.body;
  const task = await db.getTaskById(req.params.id);

  if (!task || task.user_id !== req.session.user.id) {
    return res.status(404).send('Vazifa topilmadi.');
  }

  if (!title || !title.trim()) {
    return res.status(400).render('edit-task', { task, error: 'Vazifa nomi bo\'sh bo\'lishi mumkin emas.' });
  }

  try {
    await db.updateTask(
      req.params.id,
      req.session.user.id,
      title.trim(),
      description ? description.trim() : '',
      allowedPriorities.has(priority) ? priority : 'medium',
      due_date || null
    );
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Edit task error:', error);
    res.status(500).render('edit-task', { task, error: 'Vazifani saqlashda xatolik yuz berdi.' });
  }
});

app.post('/tasks/:id/toggle', requireAuth, async (req, res) => {
  try {
    const task = await db.getTaskById(req.params.id);
    if (!task || task.user_id !== req.session.user.id) {
      return res.status(403).send('Sizga bu vazifani o\'zgartirishga ruxsat yo\'q.');
    }

    await db.toggleTask(req.params.id);
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Toggle task error:', error);
    res.status(500).send('Vazifa holatini o\'zgartirishda xatolik yuz berdi.');
  }
});

app.post('/tasks/:id/delete', requireAuth, async (req, res) => {
  try {
    const task = await db.getTaskById(req.params.id);
    if (!task || task.user_id !== req.session.user.id) {
      return res.status(403).send('Sizga bu vazifani o\'chirishga ruxsat yo\'q.');
    }

    await db.deleteTask(req.params.id);
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).send('Vazifa o\'chirishda xatolik yuz berdi.');
  }
});

app.get('/admin', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await db.getUsers();
    const tasks = await db.getAllTasks();
    res.render('admin', { users, tasks });
  } catch (error) {
    console.error('Admin error:', error);
    res.status(500).send('Admin paneli yuklanmadi.');
  }
});

app.use((req, res) => {
  res.status(404).send('Sahifa topilmadi.');
});

async function startServer() {
  try {
    await db.init();
    app.listen(PORT, () => {
      console.log(`Server ishlayapti: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Serverni ishga tushirishda xatolik:', error);
    process.exit(1);
  }
}

startServer();
