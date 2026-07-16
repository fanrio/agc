const cds = require('@sap/cds');
async function run() {
  const db = await cds.connect.to('db');
  
  const assignments = await db.run(SELECT.from('fanrio.auth.RoleAssignments'));
  console.log('--- RoleAssignments ---');
  console.log(JSON.stringify(assignments, null, 2));
}
run().catch(console.error);
