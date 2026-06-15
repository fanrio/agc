const urlBase = 'http://localhost:4004/odata/v4/auth';

async function testRunTaskChain() {
  console.log('--- Triggering runBdcTaskChain with Mock URL ---');
  const payload = {
    url: 'https://mock-tenant.datasphere.cloud.sap',
    tokenUrl: 'https://cimt-ag-1.authentication.eu10.hana.ondemand.com/oauth/token',
    clientId: 'sb-d80c9da5-fad8-4582-8675-aa99cd94f1c9!b496122|client!b3650',
    clientSecret: '314d1aa2-5b3c-4a3a-856e-009ab89fb56a$Er_Epdx7uLS-N2gLozbnGuTnl9xpW6yAe42U1dT1KjY=',
    space: 'HH_SAP',
    taskChainId: 'ts_authorization_flat'
  };

  try {
    const res = await fetch(`${urlBase}/runBdcTaskChain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const rawText = await res.text();
    console.log('Response Status:', res.status);
    console.log('Response Body:', rawText);
  } catch (err) {
    console.error('Network/Fetch Error:', err);
  }
}

testRunTaskChain();
