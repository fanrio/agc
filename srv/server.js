const cds = require('@sap/cds');

// Register simulated user Express middleware during bootstrap
cds.on('bootstrap', (app) => {
  app.use((req, res, next) => {
    const simUser = req.headers['x-simulated-user'] || req.headers['X-Simulated-User'];
    if (simUser) {
      req.user = new cds.User({ id: simUser });
    }
    next();
  });
});

module.exports = cds.server;
