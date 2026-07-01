const cds = require('@sap/cds');
async function run() {
  const db = await cds.connect.to('db');
  
  const restrictions = await db.run(SELECT.from('fanrio.auth.Restrictions'));
  console.log('--- Restrictions ---');
  console.log(JSON.stringify(restrictions, null, 2));
}
run().catch(console.error);
