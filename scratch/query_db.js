const cds = require('@sap/cds');
async function run() {
  const db = await cds.connect.to('db');
  
  const auths = await db.run(SELECT.from('fanrio.auth.BdcSettings'));
  console.log('--- BdcSettings ---');
  console.log(JSON.stringify(auths, null, 2));
}
run().catch(console.error);
