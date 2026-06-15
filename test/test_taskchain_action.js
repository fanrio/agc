const assert = require('assert');

const urlBase = 'http://localhost:4004/odata/v4/auth';

async function runAutomationTest() {
  console.log('=== START DB DIAGNOSTIC FOR TASK CHAINS ===');
  
  const hana = require('@sap/hana-client');
  const connParams = {
    serverNode: 'f346f606-7531-4a17-ba44-e6cdb0afc8a5.hana.prod-eu10.hanacloud.ondemand.com:443',
    uid: 'HH_SAP#AEISELE',
    pwd: 'H]<0d/O<P=WA<N8H.5[SU.Oq]LLb:Q`W',
    encrypt: 'true',
    sslValidateCertificate: 'true',
    sslHostNameInCertificate: 'f346f606-7531-4a17-ba44-e6cdb0afc8a5.hana.prod-eu10.hanacloud.ondemand.com'
  };

  const conn = hana.createConnection();
  
  try {
    await new Promise((resolve, reject) => {
      conn.connect(connParams, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log('✔ Connected to HANA Cloud successfully.');

    // Let's query all tables in user schemas
    const queryTables = `
      SELECT SCHEMA_NAME, TABLE_NAME 
      FROM TABLES 
      WHERE SCHEMA_NAME NOT IN ('SYS', '_SYS_BI', '_SYS_BIC', '_SYS_STATISTICS', '_SYS_XS')
    `;
    const tables = await new Promise((resolve, reject) => {
      conn.exec(queryTables, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    console.log('All Visible Tables:', tables);

    // Let's query all views in user schemas
    const queryViews = `
      SELECT SCHEMA_NAME, VIEW_NAME 
      FROM VIEWS 
      WHERE SCHEMA_NAME NOT IN ('SYS', '_SYS_BI', '_SYS_BIC', '_SYS_STATISTICS', '_SYS_XS')
    `;
    const views = await new Promise((resolve, reject) => {
      conn.exec(queryViews, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    console.log('All Visible Views:', views);

    conn.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ DB Diagnostic failed:', err.message);
    try { conn.disconnect(); } catch (e) {}
    process.exit(1);
  }
}

runAutomationTest();
