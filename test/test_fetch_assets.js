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

async function run() {
  try {
    const token = await _getOAuthToken();
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    };

    console.log('\n--- Fetching Assets ---');
    const res = await fetch(`${url}/api/v1/datasphere/consumption/catalog/assets`, {
      headers
    });
    console.log('Status:', res.status);
    const data = await res.json();
    const spaceAssets = data.value ? data.value.filter(a => a.spaceName === space) : [];
    console.log(`Assets in space ${space}:`, JSON.stringify(spaceAssets, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
