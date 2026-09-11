// Run while the application is stopped, after backing up uploads and the database.
const fs = require('node:fs/promises');
const path = require('node:path');

async function migrate(root = process.cwd()) {
  const source = path.join(root, 'public/uploads/dependent-attachments');
  const target = path.join(root, 'uploads/dependent-attachments');
  const files = await fs.readdir(source, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  await fs.mkdir(target, { recursive: true, mode: 0o700 });
  for (const file of files) {
    if (!file.isFile()) throw new Error('Unexpected entry in legacy attachment directory');
    const destination = await fs.lstat(path.join(target, file.name)).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (destination && !destination.isFile()) throw new Error('Unexpected destination in attachment directory');
    const original = await fs.readFile(path.join(source, file.name));
    const existing = await fs.readFile(path.join(target, file.name)).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing && !original.equals(existing)) throw new Error('Attachment filename conflict; migration stopped');
  }
  for (const file of files) {
    const from = path.join(source, file.name);
    const to = path.join(target, file.name);
    // Exclusive copy: a concurrent destination change cannot be overwritten.
    try { await fs.copyFile(from, to, require('node:fs').constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (!(await fs.readFile(from)).equals(await fs.readFile(to))) throw new Error('Attachment verification failed');
    await fs.chmod(to, 0o600);
    await fs.unlink(from);
  }
  console.log(`Migrated ${files.length} dependent attachments`);
}
module.exports = { migrate };
if (require.main === module) migrate().catch(error => { console.error(error.message); process.exitCode = 1; });
