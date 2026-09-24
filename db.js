const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'tasks.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath);

function init() {
  return new Promise(async (resolve, reject) => {
    try {
      await ensureUserTable();
      await ensureTasksTable();
      await seedDefaultUsers();
      await seedSampleTasks();
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function ensureUserTable() {
  return new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function ensureTasksTable() {
  return new Promise((resolve, reject) => {
    db.all('PRAGMA table_info(tasks)', async (err, columns) => {
      if (err) {
        reject(err);
        return;
      }

      if (!columns || columns.length === 0) {
        db.run(`
          CREATE TABLE tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            completed INTEGER DEFAULT 0,
            priority TEXT DEFAULT 'medium',
            due_date TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
          )
        `, (createErr) => {
          if (createErr) {
            reject(createErr);
            return;
          }
          resolve();
        });
        return;
      }

      const requiredColumns = ['user_id', 'priority', 'due_date'];
      const missingColumns = requiredColumns.filter((columnName) => !columns.some((column) => column.name === columnName));

      if (missingColumns.length > 0) {
        const operations = missingColumns.map((columnName) => {
          if (columnName === 'user_id') {
            return new Promise((runResolve, runReject) => {
              db.run('ALTER TABLE tasks ADD COLUMN user_id INTEGER DEFAULT 1', (alterErr) => {
                if (alterErr) {
                  runReject(alterErr);
                  return;
                }
                db.run('UPDATE tasks SET user_id = 1 WHERE user_id IS NULL', (updateErr) => {
                  if (updateErr) {
                    runReject(updateErr);
                    return;
                  }
                  runResolve();
                });
              });
            });
          }

          if (columnName === 'priority') {
            return new Promise((runResolve, runReject) => {
              db.run('ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT "medium"', (err2) => {
                if (err2) {
                  runReject(err2);
                  return;
                }
                runResolve();
              });
            });
          }

          if (columnName === 'due_date') {
            return new Promise((runResolve, runReject) => {
              db.run('ALTER TABLE tasks ADD COLUMN due_date TEXT', (err2) => {
                if (err2) {
                  runReject(err2);
                  return;
                }
                runResolve();
              });
            });
          }

          return Promise.resolve();
        });

        try {
          await Promise.all(operations);
          resolve();
        } catch (addErr) {
          reject(addErr);
        }
        return;
      }

      resolve();
    });
  });
}

async function seedDefaultUsers() {
  const adminExists = await getUserByEmail('admin@demo.com');
  if (!adminExists) {
    const adminPassword = await bcrypt.hash('admin123', 10);
    await createUser('Admin', 'admin@demo.com', adminPassword, 'admin');
  }

  const userExists = await getUserByEmail('user@demo.com');
  if (!userExists) {
    const userPassword = await bcrypt.hash('user123', 10);
    await createUser('User', 'user@demo.com', userPassword, 'user');
  }
}

async function seedSampleTasks() {
  const admin = await getUserByEmail('admin@demo.com');
  const count = await getTaskCountForUser(admin.id);

  if (count === 0) {
    await createTask(admin.id, 'Loyiha boshlash', 'Dastlabki loyiha strukturasi tayyorlandi.', 'high', '2026-09-30', false);
    await createTask(admin.id, 'Buglarni tekshirish', 'Login va admin panelini tekshirish.', 'medium', '2026-10-05', true);
  }
}

function getUserByEmail(email) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row || null);
    });
  });
}

function createUser(name, email, passwordHash, role = 'user') {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, email, passwordHash, role],
      function (err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.lastID);
      }
    );
  });
}

function getUsers() {
  return new Promise((resolve, reject) => {
    db.all('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC', (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

function getAllTasks() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT tasks.*, users.name AS user_name
       FROM tasks
       JOIN users ON tasks.user_id = users.id
       ORDER BY tasks.created_at DESC`,
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      }
    );
  });
}

function getTaskById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM tasks WHERE id = ?', [id], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row || null);
    });
  });
}

function getTasksByUserId(userId, filter = 'all', search = '') {
  return new Promise((resolve, reject) => {
    let query = 'SELECT * FROM tasks WHERE user_id = ?';
    const params = [userId];

    if (filter === 'completed') {
      query += ' AND completed = 1';
    } else if (filter === 'pending') {
      query += ' AND completed = 0';
    }

    if (search) {
      query += ' AND (title LIKE ? OR description LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    query += ' ORDER BY created_at DESC';

    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

function updateTask(id, userId, title, description, priority, dueDate) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE tasks
       SET title = ?, description = ?, priority = ?, due_date = ?
       WHERE id = ? AND user_id = ?`,
      [title, description, priority, dueDate, id, userId],
      function (err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes > 0);
      }
    );
  });
}

function getTaskSummaryByUserId(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) AS high_priority
       FROM tasks
       WHERE user_id = ?`,
      [userId],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({
          total: row?.total || 0,
          completed: row?.completed || 0,
          pending: row?.pending || 0,
          highPriority: row?.high_priority || 0,
        });
      }
    );
  });
}

function getTaskCountForUser(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) AS count FROM tasks WHERE user_id = ?', [userId], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row ? row.count : 0);
    });
  });
}

function createTask(userId, title, description = '', priority = 'medium', dueDate = null, completed = false) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO tasks (user_id, title, description, completed, priority, due_date) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, title, description, completed ? 1 : 0, priority, dueDate],
      function (err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.lastID);
      }
    );
  });
}

function toggleTask(id) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE tasks SET completed = CASE WHEN completed = 0 THEN 1 ELSE 0 END WHERE id = ?',
      [id],
      function (err) {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      }
    );
  });
}

function deleteTask(id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM tasks WHERE id = ?', [id], function (err) {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

module.exports = {
  init,
  getUserByEmail,
  createUser,
  getUsers,
  getAllTasks,
  getTaskById,
  getTasksByUserId,
  getTaskSummaryByUserId,
  createTask,
  updateTask,
  toggleTask,
  deleteTask,
};
