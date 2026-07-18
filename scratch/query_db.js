const cds = require('@sap/cds');
async function run() {
  const db = await cds.connect.to('db');
  
  const auths = await db.run(SELECT.from('fanrio.auth.AppAuthorizations'));
  console.log('--- AppAuthorizations ---');
  console.log(JSON.stringify(auths, null, 2));

  const approvers = await db.run(SELECT.from('fanrio.auth.RoleApprovers'));
  console.log('--- RoleApprovers ---');
  console.log(JSON.stringify(approvers, null, 2));
}
run().catch(console.error);
