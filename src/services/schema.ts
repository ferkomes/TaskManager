import schema from '../../schema.sql';
const initialized = new WeakMap<D1Database, Promise<void>>();
export async function ensureSchema(db: D1Database) {
  if (!db) throw new Error('D1 binding DB is missing');
  if (!initialized.has(db)) {
    const run = (async () => {
      const statements = schema.replace(/^\s*--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean);
      for (let i=0;i<statements.length;i+=20) await db.batch(statements.slice(i,i+20).map(sql=>db.prepare(sql)));
    })().catch(error=>{initialized.delete(db);throw error;});
    initialized.set(db,run);
  }
  await initialized.get(db);
}
