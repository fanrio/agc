async function run() {
  try {
    const res = await fetch('http://localhost:4004/odata/v4/auth/BdcSettings');
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('BdcSettings:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Fetch failed:', e);
  }
}

run();
