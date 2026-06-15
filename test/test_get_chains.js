const tokenUrl = 'https://cimt-ag-1.authentication.eu10.hana.ondemand.com/oauth/token';
const clientId = 'sb-d80c9da5-fad8-4582-8675-aa99cd94f1c9!b496122|client!b3650';
const clientSecret = '314d1aa2-5b3c-4a3a-856e-009ab89fb56a$Er_Epdx7uLS-N2gLozbnGuTnl9xpW6yAe42U1dT1KjY=';
const url = 'https://cimt-ag-1.eu10.hcs.cloud.sap';
const space = 'HH_SAP';

async function _getOAuthToken() {
  const authHeader = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!tokenRes.ok) throw new Error('Token fetch failed');
  const data = await tokenRes.json();
  return data.access_token;
}

async function testGet() {
  try {
    const token = await _getOAuthToken();
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

    const endpoints = [
      `/api/v1/datasphere/tasks/chains/${space}`,
      `/api/v1/datasphere/tasks/logs/${space}`,
      `/api/v1/datasphere/tasks/chains/${space}/ts_authorization_flat`
    ];

    for (const ep of endpoints) {
      console.log(`\n--- Fetching: ${ep} ---`);
      const res = await fetch(`${url}${ep}`, { headers });
      console.log('Status:', res.status);
      const text = await res.text();
      console.log('Body:', text.substring(0, 1000));
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

testGet();
