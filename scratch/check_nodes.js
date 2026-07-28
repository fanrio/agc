const cds = require('@sap/cds');

async function test() {
  await cds.connect.to('db');
  const { OrgNodes, RestrictionFields, AccessDomainFields } = cds.entities('fanrio.auth');
  const nodes = await cds.db.run(SELECT.from(OrgNodes));
  console.log('Nodes:', nodes.map(n => ({ id: n.ID, name: n.name, type_ID: n.type_ID })));

  const rf = await cds.db.run(SELECT.from(RestrictionFields));
  console.log('RestrictionFields:', rf);

  const adf = await cds.db.run(SELECT.from(AccessDomainFields));
  console.log('AccessDomainFields:', adf);
}

test();
