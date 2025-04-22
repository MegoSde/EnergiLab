const mqtt = require('mqtt');
const db = require('./db'); // brug central database pool

let client = null;
let connectedSessionId = null;

async function getActiveSession() {
  const result = await db.query('SELECT * FROM current_session_state');
  return result.rows[0] || null;
}

async function saveMeasurement(sessionId, timestamp, source, key, value) {
  await db.query(
    `INSERT INTO measurements (session_id, timestamp, source, key, value)
     VALUES ($1, to_timestamp($2), $3, $4, $5)`,
    [sessionId, timestamp, source, key, value]
  );
}

function parseAndStore(session, topic, payloadStr) {
  try {
    const payload = JSON.parse(payloadStr);
    const timestamp = payload.ts || Math.floor(Date.now() / 1000); // fallback til nu
    const source = payload.src || session.mqtt_alias;

    const flat = flattenMQTT(payload);

    for (const [key, value] of Object.entries(flat)) {
      if (typeof value === 'number') {
        saveMeasurement(session.session_id, timestamp, source, key, value)
          .catch(err => console.error('Fejl ved insert:', err.message));
      }
    }
  } catch (err) {
    console.warn('Ugyldigt payload', err.message);
  }
}

function flattenMQTT(payload) {
  const out = {};
  function recurse(obj, prefix = '') {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        recurse(v, key);
      } else if (typeof v === 'number') {
        out[key] = v;
      }
    }
  }

  if (payload.params) recurse(payload.params); // shelly events
  else recurse(payload);
  return out;
}

async function connectMQTT(session) {
  const url = `mqtt://${session.mqtt_host}:${session.mqtt_port}`;
  const topic = `${session.mqtt_alias}/#`;

  console.log(`🔌 Forbinder til ${url}, lytter på ${topic}`);
  client = mqtt.connect(url);

  client.on('connect', () => {
    console.log('✅ MQTT forbundet');
    client.subscribe(topic);
  });

  client.on('message', async (topic, message) => {
    const session = await getActiveSession();
    if (session) {
      parseAndStore(session, topic, message.toString());
    } else {
      console.log('⏹ Ingen aktiv session – data ignoreret');
    }
  });

  client.on('error', err => {
    console.error('MQTT fejl:', err.message);
  });
}

async function main() {
  const session = await getActiveSession();

  if (!session) {
    console.log('❌ Ingen aktiv session – venter...');
    setTimeout(main, 5000);
    return;
  }

  connectedSessionId = session.session_id;
  await connectMQTT(session);

  // Poll hver 10. sek for ny session (ændringer)
  setInterval(async () => {
    const current = await getActiveSession();
    if (!current || current.session_id !== connectedSessionId) {
      console.log('🔄 Session ændret – genstarter MQTT');
      client?.end(true);
      connectedSessionId = null;
      main(); // rekursiv genstart
    }
  }, 10000);
}

main().catch(console.error);
