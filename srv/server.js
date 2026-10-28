const cds = require('@sap/cds');
const path = require('path');
const { spawn } = require('child_process');

// Register simulated user Express middleware during bootstrap (non-production only)
cds.on('bootstrap', (app) => {
  // Set standard HTTP security headers on every response
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'"
    );
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

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

// Auto-spawn Vite frontend when running under dev/watch (non-production and not test)
let viteProcess = null;
cds.on('listening', () => {
  const isTest = process.env.NODE_ENV === 'test' || 
                 process.execArgv.includes('--test') || 
                 (process.argv[1] && process.argv[1].includes('test'));

  if (process.env.NODE_ENV !== 'production' && !isTest && !viteProcess) {
    const frontendDir = path.resolve(__dirname, '..', 'app', 'catalog');
    const viteBin = path.resolve(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');
    console.log('[cds] - Spawning Vite frontend in', frontendDir);

    viteProcess = spawn(process.execPath, [viteBin], {
      cwd: frontendDir,
      stdio: 'inherit'
    });

    viteProcess.on('error', (err) => {
      console.error('[cds] - Failed to start Vite frontend dev server:', err);
    });

    const cleanup = () => {
      if (viteProcess) {
        try {
          viteProcess.kill();
        } catch (_) {}
        viteProcess = null;
      }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }
});

module.exports = cds.server;
