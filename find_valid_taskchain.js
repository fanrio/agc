const tokenUrl = 'https://cimt-ag-1.authentication.eu10.hana.ondemand.com/oauth/token';
const clientId = 'sb-d80c9da5-fad8-4582-8675-aa99cd94f1c9!b496122|client!b3650';
const clientSecret = '314d1aa2-5b3c-4a3a-856e-009ab89fb56a$Er_Epdx7uLS-N2gLozbnGuTnl9xpW6yAe42U1dT1KjY=';
const url = 'https://cimt-ag-1.eu10.hcs.cloud.sap';

const spaces = ["TEST", "ZEP_CGN", "HH_SAP_SELF_SERVICE", "HH_SAP", "CGN_TRAINING", "HH_DEMO"];
const taskChains = ["ts_authorization_flat", "df_authorization_flat", "ts_authoriziation_flat"];

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
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    for (const space of spaces) {
      for (const tc of taskChains) {
        const endpoint = `${url}/api/v1/datasphere/tasks/chains/${space}/run/${tc}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({})
        });
        const text = await res.text();
        if (res.status !== 400 || !text.includes("Bad request")) {
          console.log(`[FOUND DIFFERENCE] Space: ${space}, TaskChain: ${tc} -> Status: ${res.status}, Response: ${text}`);
        } else {
          // Log standard 400
          console.log(`Space: ${space}, TaskChain: ${tc} -> 400 Bad Request`);
        }
      }
    }
    console.log('Finished testing all combinations.');
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
