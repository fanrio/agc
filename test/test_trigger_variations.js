const tokenUrl = 'https://cimt-ag-1.authentication.eu10.hana.ondemand.com/oauth/token';
const clientId = 'sb-d80c9da5-fad8-4582-8675-aa99cd94f1c9!b496122|client!b3650';
const clientSecret = '314d1aa2-5b3c-4a3a-856e-009ab89fb56a$Er_Epdx7uLS-N2gLozbnGuTnl9xpW6yAe42U1dT1KjY=';
const url = 'https://cimt-ag-1.eu10.hcs.cloud.sap';
const space = 'HH_SAP';
const taskChainId = 'ts_authorization_flat';

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

async function run() {
  try {
    const token = await _getOAuthToken();
    const endpoint = `${url}/api/v1/datasphere/tasks/chains/${space}/run/${taskChainId}`;

    // Variation 1: POST with empty body, Content-Type: application/json
    console.log('\n--- Variation 1: POST with JSON.stringify({}), Content-Type: application/json ---');
    const res1 = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    console.log('Status:', res1.status);
    console.log('Body:', await res1.text());

    // Variation 2: POST with body: undefined (no Content-Type)
    console.log('\n--- Variation 2: POST with body: undefined, no Content-Type ---');
    const res2 = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    console.log('Status:', res2.status);
    console.log('Body:', await res2.text());

    // Variation 3: POST with body: "", no Content-Type
    console.log('\n--- Variation 3: POST with body: "", no Content-Type ---');
    const res3 = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      body: ''
    });
    console.log('Status:', res3.status);
    console.log('Body:', await res3.text());

  } catch (err) {
    console.error('Error:', err);
  }
}

run();
