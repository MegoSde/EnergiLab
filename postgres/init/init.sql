-- Init DB for EnergiLab (idempotent)

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  start_time TIMESTAMP NOT NULL DEFAULT now(),
  end_time TIMESTAMP,
  mqtt_host TEXT NOT NULL DEFAULT 'localhost',
  mqtt_port INTEGER NOT NULL DEFAULT 1883,
  mqtt_alias TEXT NOT NULL DEFAULT 'shellies'
);


CREATE TABLE IF NOT EXISTS states (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time TIMESTAMP NOT NULL DEFAULT now(),
  end_time TIMESTAMP
);

CREATE TABLE IF NOT EXISTS measurements (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  timestamp TIMESTAMP NOT NULL,
  source TEXT NOT NULL,
  key TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL
);

-- Index for faster lookup
CREATE INDEX IF NOT EXISTS idx_measurements_session_time
ON measurements(session_id, timestamp);

-- Stored Procedure: start_session
CREATE OR REPLACE FUNCTION start_session(
  p_name TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_mqtt_host TEXT DEFAULT 'localhost',
  p_mqtt_port INTEGER DEFAULT 1883,
  p_mqtt_alias TEXT DEFAULT 'shellies'
)
RETURNS INTEGER AS $$
DECLARE
  session_id INTEGER;
  session_name TEXT := COALESCE(NULLIF(trim(p_name), ''), 'Test_' || TO_CHAR(NOW(), 'DD-MM-YYYY_HH24:MI'));
  state_name TEXT := COALESCE(NULLIF(trim(p_state), ''), 'idle');
BEGIN
  IF EXISTS (SELECT 1 FROM sessions WHERE end_time IS NULL) THEN
    RAISE EXCEPTION 'En session er allerede aktiv';
  END IF;

  INSERT INTO sessions(name, start_time, mqtt_host, mqtt_port, mqtt_alias)
  VALUES (session_name, now(), p_mqtt_host, p_mqtt_port, p_mqtt_alias)
  RETURNING id INTO session_id;

  INSERT INTO states(session_id, name, start_time)
  VALUES (session_id, state_name, now());

  RETURN session_id;
END;
$$ LANGUAGE plpgsql;


-- Stored Procedure: change_state
CREATE OR REPLACE FUNCTION change_state(p_state TEXT, p_session_id INTEGER DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  IF NULLIF(trim(p_state), '') IS NULL THEN
    RAISE EXCEPTION 'State-navn må ikke være tomt';
  END IF;

  -- Find aktiv session hvis p_session_id er NULL
  IF p_session_id IS NULL THEN
    SELECT id INTO p_session_id
    FROM sessions
    WHERE end_time IS NULL
    ORDER BY start_time DESC
    LIMIT 1;
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Ingen aktiv session fundet';
  END IF;

  -- Afslut aktiv state
  UPDATE states
  SET end_time = now()
  WHERE session_id = p_session_id AND end_time IS NULL;

  -- Start ny state
  INSERT INTO states (session_id, name, start_time)
  VALUES (p_session_id, p_state, now());
END;
$$ LANGUAGE plpgsql;


-- Stored Procedure: stop_session
CREATE OR REPLACE FUNCTION stop_session(p_session_id INTEGER DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  -- Find aktiv session hvis p_session_id er NULL
  IF p_session_id IS NULL THEN
    SELECT id INTO p_session_id
    FROM sessions
    WHERE end_time IS NULL
    ORDER BY start_time DESC
    LIMIT 1;
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Ingen aktiv session fundet';
  END IF;

  -- Afslut aktiv state
  UPDATE states
  SET end_time = now()
  WHERE session_id = p_session_id AND end_time IS NULL;

  -- Afslut session
  UPDATE sessions
  SET end_time = now()
  WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql;



-- View: current_session_state
DROP VIEW IF EXISTS current_session_state;
CREATE VIEW current_session_state AS
SELECT *
FROM (
  SELECT
    s.id AS session_id,
    s.name AS session_name,
    s.start_time AS session_start,
    s.mqtt_host,
    s.mqtt_port,
    s.mqtt_alias,
    st.name AS state_name,
    st.start_time AS state_start
  FROM sessions s
  JOIN states st ON st.session_id = s.id
  WHERE s.end_time IS NULL AND st.end_time IS NULL
  ORDER BY s.start_time DESC
  LIMIT 1
) AS active;

-- View: test_summary
DROP VIEW IF EXISTS test_summary;
CREATE OR REPLACE VIEW test_summary AS
WITH energy_per_session AS (
  SELECT
    session_id,
    SUM(value) AS total_energy_j,
    MIN(timestamp) AS first,
    MAX(timestamp) AS last
  FROM measurements
  WHERE key = 'jenergy'
  GROUP BY session_id
),
averages AS (
  SELECT
    session_id,
    AVG(CASE WHEN key = 'apower' THEN value ELSE NULL END) AS avg_power,
    AVG(CASE WHEN key = 'temperature.tC' THEN value ELSE NULL END) AS avg_temperature,
    AVG(CASE WHEN key = 'cpu' THEN value ELSE NULL END) AS avg_cpu
  FROM measurements
  GROUP BY session_id
)
SELECT
  s.id AS session_id,
  s.name AS session_name,
  s.start_time,
  s.end_time,
  ROUND(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60, 1) AS duration_minutes,
  ROUND(e.total_energy_j::NUMERIC, 2) AS energy_j,
  ROUND(a.avg_power::NUMERIC, 2) AS avg_power_w,
  ROUND(a.avg_temperature::NUMERIC, 1) AS avg_temperature_c,
  ROUND(a.avg_cpu::NUMERIC, 1) AS avg_cpu
FROM sessions s
LEFT JOIN energy_per_session e ON e.session_id = s.id
LEFT JOIN averages a ON a.session_id = s.id
ORDER BY s.start_time DESC;

DROP FUNCTION IF EXISTS public.get_state_summary(int4);
CREATE FUNCTION public.get_state_summary(p_session_id integer)
 RETURNS TABLE(
   session_id integer,
   session_name text,
   state_id integer,
   state_name text,
   start_time timestamp without time zone,
   end_time timestamp without time zone,
   duration_minutes numeric,
   energy_j numeric,
   avg_power_w numeric,
   avg_temperature_c numeric,
   avg_cpu numeric
 )
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    st.session_id,
    s.name AS session_name,
    st.id AS state_id,
    st.name AS state_name,
    st.start_time,
    st.end_time,
    ROUND((EXTRACT(EPOCH FROM (st.end_time - st.start_time)) / 60)::NUMERIC, 1),
    ROUND((
      SELECT SUM(m.value)
      FROM measurements m
      WHERE m.session_id = st.session_id
        AND m.timestamp BETWEEN st.start_time AND st.end_time
        AND m.key = 'jenergy'
    )::NUMERIC, 2),
    ROUND((
      SELECT AVG(value)
      FROM measurements m
      WHERE m.session_id = st.session_id
        AND m.timestamp BETWEEN st.start_time AND st.end_time
        AND m.key = 'apower'
    )::NUMERIC, 2),
    ROUND((
      SELECT AVG(value)
      FROM measurements m
      WHERE m.session_id = st.session_id
        AND m.timestamp BETWEEN st.start_time AND st.end_time
        AND m.key = 'temperature.tC'
    )::NUMERIC, 1),
    ROUND((
      SELECT AVG(value)
      FROM measurements m
      WHERE m.session_id = st.session_id
        AND m.timestamp BETWEEN st.start_time AND st.end_time
        AND m.key = 'cpu'
    )::NUMERIC, 1)
  FROM states st
  JOIN sessions s ON s.id = st.session_id
  WHERE st.session_id = p_session_id
  ORDER BY st.start_time;
END;
$function$;

