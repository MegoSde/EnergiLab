// mqtt-service.js - Driven by index.js with startService, newSession, updateSession, stopSession
let activeSession = null;
let client = null;
let isConnected = false;
const lastApower = {}
const liveTopics = new Set();
const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');
const db = require('./db');

const STATE_FILE = path.join(__dirname, 'mqtt_state.json');

function saveConnectionState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadConnectionState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE));
  }
  return null;
}

function connectionChanged(newSession, oldSession) {
  return !oldSession ||
    newSession.mqtt_alias !== oldSession.mqtt_alias ||
    newSession.mqtt_host !== oldSession.mqtt_host ||
    newSession.mqtt_port !== oldSession.mqtt_port;
}

function trackTopic(topic) {
  if (!liveTopics.has(topic)) {
    liveTopics.add(topic);
    console.log('🔔 New topic detected:', topic);
  }
}

function sendGetStatusToAllSwitches() {
  for (const topic of liveTopics) {
    if (topic.includes('switch')) {
      const base = topic.split('/')[0];
      const msg = {
        id: Math.floor(Math.random() * 10000),
        src: `${base}/EnergiLab`,
        method: 'Switch.GetStatus',
        params: { id: 0 }
      };
      client.publish(`${base}/rpc`, JSON.stringify(msg));
      console.log('📨 RPC →', `${base}/rpc`);
    }
  }
}

async function saveMeasurement(sessionId, timestamp, source, key, value) {
  await db.query(
    `INSERT INTO measurements (session_id, timestamp, source, key, value)
     VALUES ($1, to_timestamp($2), $3, $4, $5)`,
    [sessionId, timestamp, source, key, value]
  );
}

async function updateLiveMeasurement(topic, payload) {
  await db.query(`
    INSERT INTO live_measurements (topic, timestamp, data)
    VALUES ($1, now(), $2)
    ON CONFLICT (topic)
    DO UPDATE SET timestamp = now(), data = EXCLUDED.data
  `, [topic, payload]);
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
  if (payload.params) recurse(payload.params);
  else recurse(payload);
  return out;
}

async function connectMQTT(session) {
  const url = `mqtt://${session.mqtt_host}:${session.mqtt_port}`;
  const topic = `${session.mqtt_alias}/#`;

  console.log('🔌 Connecting MQTT to', url);
  client = mqtt.connect(url);

  client.on('connect', () => {
    isConnected = true;
    client.subscribe(topic);
    console.log('✅ MQTT subscribed:', topic);
    saveConnectionState({
      mqtt_host: session.mqtt_host,
      mqtt_port: session.mqtt_port,
      mqtt_alias: session.mqtt_alias
    });
  });

  client.on('message', async (topic, message) => {
    const alias = activeSession?.mqtt_alias || 'shellies';
    if (topic.startsWith(`${alias}/rpc`) || topic.startsWith(`${alias}/events`)) return;
    trackTopic(topic);
    

    const payloadStr = message.toString();
    try {
      let payload = JSON.parse(payloadStr);
      if (topic === `${alias}/EnergiLab/rpc` && payload.result) {
        payload = payload.result;
        topic = `${topic}:${payload.id}`;
      }
      const timestamp = payload.ts || Math.floor(Date.now() / 1000);
      const source = topic;

      updateLiveMeasurement(topic, payloadStr).catch(console.warn);
      if (activeSession && activeSession.session_id) {
        const flat = flattenMQTT(payload);
        for (const [key, value] of Object.entries(flat)) {
          if (typeof value === 'number') {
            saveMeasurement(activeSession.session_id, timestamp, source, key, value).catch(() => {});

            if (key === 'apower' ) {
              const id = topic.split(':').pop();
              const last = lastApower[id];
              if (last) {
                const dt = timestamp - last.ts;
                const energyJ = last.value * dt;
                const calcTopic = `calculated:${id}`;
                saveMeasurement(activeSession.session_id, timestamp, calcTopic, 'jenergy', energyJ).catch(() => {});
              }
              lastApower[id] = { ts: timestamp, value };
            }
          }
        }
      }
    } catch (err) {
      console.warn('❗ JSON parse error for MQTT payload:', err.message);
    }
  });

  client.on('error', err => {
    console.warn('⚠️ MQTT error:', err.message);
  });

  client.on('close', () => {
    console.log('❌ MQTT disconnected');
    isConnected = false;
    liveTopics.clear();
  });
}

async function startService(initialSession) {
  const fallback = loadConnectionState();
  activeSession = initialSession || fallback;

  if (!activeSession || !activeSession.mqtt_host || !activeSession.mqtt_port || !activeSession.mqtt_alias) {
    console.warn('⚠️ No valid MQTT session config');
    return;
  }

  await connectMQTT(activeSession);
  sendGetStatusToAllSwitches();
}

async function newSession(session) {
  if (!session || !session.mqtt_host || !session.mqtt_port || !session.mqtt_alias) return;
  if (!connectionChanged(session, activeSession)) {
    activeSession = session;
    return;
  }

  console.log('🔄 New MQTT session config detected – reconnecting');
  client?.end(true);
  liveTopics.clear();
  isConnected = false;
  activeSession = session;
  await connectMQTT(activeSession);
  sendGetStatusToAllSwitches();
}

function updateSession() {
  if (isConnected) {
    sendGetStatusToAllSwitches();
  }
}

function stopSession() {
  if (activeSession) {
    activeSession.session_id = null;
  }
}

function shutdown() {
  if (client) {
    console.log('🛑 Lukker MQTT-forbindelse...');
    client.end(true);
  }
}

module.exports = {
  startService,
  newSession,
  updateSession,
  stopSession,
  shutdown
};
