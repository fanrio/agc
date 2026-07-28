const cds = require('@sap/cds');

// Register simulated user Express middleware during bootstrap (non-production only)
cds.on('bootstrap', (app) => {
  app.use((req, res, next) => {
    const isTest = process.env.NODE_ENV === 'test' || 
                   process.execArgv.includes('--test') || 
                   (process.argv[1] && process.argv[1].includes('test'));
    if (process.env.NODE_ENV !== 'production' || isTest) {
      const simUser = req.headers['x-simulated-user'] || req.headers['X-Simulated-User'] || (isTest ? 'admin' : null);
      if (simUser) {
        req.user = new cds.User({ id: simUser, roles: ['authenticated-user'] });
      }
    }
    next();
  });
});

module.exports = cds.server;
