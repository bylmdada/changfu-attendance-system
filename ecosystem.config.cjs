const port = process.env.PORT || '3000';
const hostname = process.env.HOSTNAME || '0.0.0.0';

module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || 'attendance',
      cwd: __dirname,
      script: process.env.NODE_BINARY || 'node',
      args: `./node_modules/next/dist/bin/next start --port ${port} --hostname ${hostname}`,
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '700M',
      env: {
        NODE_ENV: 'production',
        PORT: port,
        HOSTNAME: hostname,
        TZ: process.env.TZ || 'Asia/Taipei',
        NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || '1',
        APP_NODE_VERSION: process.env.APP_NODE_VERSION || process.version.replace(/^v/, ''),
      },
    },
  ],
};
