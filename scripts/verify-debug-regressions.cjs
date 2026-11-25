// Isolated checks: no application server, production files, or external requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { productionDatabase } = require('./production-database.cjs');
const { migrate } = require('./migrate-dependent-attachments.cjs');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changfu-debug-'));
  const priorDatabase = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    const env = path.join(root, '.env.production');
    fs.writeFileSync(env, `DATABASE_URL="file:${root}/test.db"`);
    assert.equal(productionDatabase(env), `${root}/test.db`);
    process.env.DATABASE_URL = 'file:/different.db';
    assert.throws(() => productionDatabase(env), /conflicts/);
    delete process.env.DATABASE_URL;
    fs.writeFileSync(env, 'DATABASE_URL="file:./prod.db"');
    assert.throws(() => productionDatabase(env), /absolute/);

    const source = path.join(root, 'public/uploads/dependent-attachments');
    const target = path.join(root, 'uploads/dependent-attachments');
    fs.mkdirSync(source, {recursive:true});
    fs.writeFileSync(path.join(source, 'proof.pdf'), 'private proof');
    await migrate(root);
    assert.equal(fs.existsSync(path.join(source, 'proof.pdf')), false);
    assert.equal(fs.readFileSync(path.join(target, 'proof.pdf'), 'utf8'), 'private proof');
    assert.equal(fs.statSync(path.join(target, 'proof.pdf')).mode & 0o777, 0o600);
    await migrate(root);
    fs.writeFileSync(path.join(source, 'proof.pdf'), 'conflict');
    await assert.rejects(migrate(root), /conflict/);
    assert.equal(fs.readFileSync(path.join(source, 'proof.pdf'), 'utf8'), 'conflict');

    const handlers = {};
    let release = 'A';
    const removed = [];
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), {
      URL, console,
      self: {location:{origin:'https://test.invalid'},addEventListener:(type, fn) => {handlers[type] = fn;},clients:{claim:async()=>{}}},
      fetch: async () => {if (release === 'offline') throw Error('offline'); return release;},
      caches: {match:async()=> 'offline page',keys:async()=>['changfu-attendance-v2','changfu-attendance-v3'],delete:async name=>removed.push(name)},
    });
    async function navigate() {
      let result;
      handlers.fetch({request:{url:'https://test.invalid/attendance',method:'GET',mode:'navigate'},respondWith:value=>{result=value;}});
      return result;
    }
    assert.equal(await navigate(), 'A');
    release = 'B';
    assert.equal(await navigate(), 'B');
    release = 'offline';
    assert.equal(await navigate(), 'offline page');
    handlers.fetch({request:{url:'https://test.invalid/api/employees',method:'GET'},respondWith:()=>assert.fail('API must bypass cache')});
    let activation;
    handlers.activate({waitUntil:value=>{activation=value;}});
    await activation;
    assert.deepEqual(removed, ['changfu-attendance-v2']);

    // 員工下拉的共用載入函式：每次都要重新請求（cache: 'no-store'），且要逐頁取完、不能只拿第一頁
    const ts = require('typescript');
    const sourceFile = (relative) => ['.ts', '.tsx'].map((ext) => path.join(__dirname, '..', `${relative}${ext}`)).find(fs.existsSync);
    const loadSource = (file, globals) => {
      const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},
      }).outputText;
      const moduleExports = {};
      vm.runInNewContext(code, {
        ...globals,
        exports: moduleExports,
        require: (id) => id.startsWith('@/') ? loadSource(sourceFile(`src/${id.slice(2)}`), globals) : require(id),
      });
      return moduleExports;
    };
    let name = 'before';
    let requests = 0;
    let pages = 1;
    const exports = loadSource(path.join(__dirname, '../src/components/EmployeeListSelect.tsx'), {
      URLSearchParams,
      fetch: async (url, options) => {
        assert.equal(options.cache, 'no-store'); requests++;
        const page = Number(new URLSearchParams(url.split('?')[1]).get('page'));
        return {ok:true,json:async()=>pages === 1
          ? ({employees:[{id:1,name}]})
          : ({employees:[{id:page,name:`page ${page}`}],pagination:{page,pages}})};
      },
    });
    assert.equal((await exports.loadEmployeeOptions())[0].name, 'before');
    name = 'after';
    assert.equal((await exports.loadEmployeeOptions())[0].name, 'after');
    assert.equal(requests, 2);
    pages = 3;
    assert.equal((await exports.loadEmployeeOptions()).map((employee) => employee.name).join(','), 'page 1,page 2,page 3');
    assert.equal(requests, 5);
    console.log('PASS: environment, private file migration, service worker, employee refresh');
  } finally {
    if (priorDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabase;
    fs.rmSync(root, {recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
