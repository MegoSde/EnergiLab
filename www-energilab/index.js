const os = require('os');
const express = require('express');
const { engine } = require('express-handlebars');
const path = require('path');
const db = require('./db');
const handlebars = require('express-handlebars');
const mqttService = require('./mqtt-service');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine setup
app.engine('hbs', handlebars.engine({
  extname: '.hbs',
  helpers: {
    formatDate: (timestamp) => {
      const d = new Date(timestamp);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    json: (context) => JSON.stringify(context)
  }
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Start MQTT service on startup
(async () => {
  const result = await db.query('SELECT * FROM current_session_state');
  const session = result.rows[0];
  mqttService.startService(session);
})();

// Routes
app.get('/', (req, res) => {
  res.render('home', { title: 'EnergiLab' });
});

app.get('/manuel', async (req, res) => {
  const result = await db.query('SELECT * FROM current_session_state');
  const session = result.rows[0];

  res.render('manuel', {
    title: 'EnergiLab - Manuel kontrol',
    session,
  });
});

app.post('/manuel/start', async (req, res) => {
  const { name, state } = req.body;

  const result = await db.query('SELECT start_session($1, $2) AS id', [name, state]);
  const sessionId = result.rows[0].id;
  console.log(`Startede session ${sessionId}`);

  const session = await db.query('SELECT * FROM current_session_state');
  mqttService.newSession(session.rows[0]);
  mqttService.updateSession();

  res.redirect('/manuel');
});

app.post('/manuel/changestate', async (req, res) => {
  const { state } = req.body;

  await db.query('SELECT change_state($1)', [state]);
  mqttService.updateSession();

  res.redirect('/manuel');
});

app.post('/manuel/stop', async (req, res) => {
  await db.query('SELECT stop_session()');
  mqttService.stopSession();
  res.redirect('/manuel');
});

// API endpoints
app.post('/api/start', async (req, res) => {
  try {
    const { name, state } = req.body;
    const result = await db.query('SELECT start_session($1, $2) AS id', [name, state]);
    const sessionId = result.rows[0].id;
    console.log(`API start: ${sessionId}`);

    const session = await db.query('SELECT * FROM current_session_state');
    mqttService.newSession(session.rows[0]);
    mqttService.updateSession();

    res.status(200).json({ status: 'ok', sessionId });
  } catch (err) {
    console.error('Error in /start:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/state', async (req, res) => {
  try {
    const { state } = req.body;
    await db.query('SELECT change_state($1)', [state]);
    mqttService.updateSession();

    console.log(`API state change: ${state}`);
    res.status(200).json({ status: 'ok', state });
  } catch (err) {
    console.error('Error in /state:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/stop', async (req, res) => {
  try {
    await db.query('SELECT stop_session()');
    mqttService.stopSession();
    console.log('API stop session');
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Error in /stop:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT s.id AS session_id, s.name, st.name AS state, st.start_time AS timestamp
      FROM sessions s
      JOIN states st ON st.session_id = s.id
      WHERE s.end_time IS NULL
      ORDER BY st.start_time DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.status(200).json({ active: false, message: "No active session" });
    }

    const row = result.rows[0];
    res.status(200).json({
      active: true,
      session: {
        id: row.session_id,
        name: row.name,
        state: row.state,
        timestamp: row.timestamp
      }
    });
  } catch (err) {
    console.error('Error in /status:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Test overview
app.get('/tests', async (req, res) => {
  const result = await db.query('SELECT * FROM test_summary');
  res.render('tests', {
    title: 'Oversigt over tests',
    tests: result.rows,
  });
});

app.get('/tests/:id', async (req, res) => {
  const { id } = req.params;
  const result = await db.query('SELECT * FROM get_state_summary($1)', [id]);

  if (result.rows.length === 0) {
    return res.status(404).send('Session ikke fundet');
  }

  const sessionName = result.rows[0].session_name;
  const [measurements, states] = await Promise.all([
    db.query(`SELECT key, value, timestamp FROM measurements
              WHERE session_id = $1 AND key IN ('apower', 'cpu')
              ORDER BY timestamp`, [id]),
    db.query(`SELECT name, start_time, end_time FROM states
              WHERE session_id = $1
              ORDER BY start_time`, [id])
  ]);

  res.render('test-details', {
    title: `Detaljer for: ${sessionName}`,
    states: result.rows,
    graphData: measurements.rows,
    stateZones: states.rows,
  });
});

function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'ukendt';
}

app.get('/info', async (req, res) => {
  const result = await db.query('SELECT * FROM current_session_state');
  const session = result.rows[0];

  res.render('info', {
    title: 'System Info',
    ip: getLocalIPv4(),
    mqtt_alias: session ? session.mqtt_alias : '– ingen aktiv session – default: shellies',
    session_name: session ? session.session_name : '- ingen aktiv session -'
  });
});

const server = app.listen(PORT, () => {
  console.log(`EnergiLab kører på http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Afslutter EnergiLab...');

  // Luk express server
  if (server && server.close) {
    server.close(() => {
      console.log('🌐 Webserver lukket');
    });
  }

  // Luk MQTT-forbindelse
  if (mqttService && mqttService.shutdown) {
    await mqttService.shutdown();
  }

  // Luk db pool hvis nødvendigt
  if (db && db.end) {
    await db.end();
    console.log('🗄️ Database lukket');
  }

  process.exit(0);
});

