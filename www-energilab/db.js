// db.js
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'energilab',
  password: 'energilab123',
  database: 'energidata',
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
