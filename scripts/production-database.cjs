const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

function productionDatabase(envFile) {
  const values = parseEnv(fs.readFileSync(envFile, 'utf8'));
  const url = values.DATABASE_URL;
  if (!url?.startsWith('file:/') || !path.isAbsolute(url.slice(5)) || /[\r\n?'"\\]/.test(url)) {
    throw new Error('DATABASE_URL must be an absolute SQLite file URL in the selected production env file');
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== url) {
    throw new Error('Shell DATABASE_URL conflicts with the selected production env file');
  }
  return path.resolve(url.slice(5));
}
module.exports = { productionDatabase };
if (require.main === module) {
  try { console.log(productionDatabase(process.argv[2] || '.env.production')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
