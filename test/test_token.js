const tokenUrl = 'https://cimt-ag-1.authentication.eu10.hana.ondemand.com/oauth/token';
const clientId = 'sb-d80c9da5-fad8-4582-8675-aa99cd94f1c9!b496122|client!b3650';
const clientSecret = '314d1aa2-5b3c-4a3a-856e-009ab89fb56a$Er_Epdx7uLS-N2gLozbnGuTnl9xpW6yAe42U1dT1KjY=';

async function testToken() {
  console.log('--- Attempting to fetch OAuth Token ---');
  try {
    const authHeader = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    console.log('Status:', tokenRes.status);
    const body = await tokenRes.text();
    console.log('Body:', body);
  } catch (err) {
    console.error('Error fetching token:', err);
  }
}

testToken();
