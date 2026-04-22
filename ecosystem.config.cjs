module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || 'attendance',
      cwd: __dirname,
      script: 'npm',
      args: 'start',
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '700M',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || '3000',
        HOSTNAME: process.env.HOSTNAME || '0.0.0.0',
        TZ: process.env.TZ || 'Asia/Taipei',
        NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || '1',
      },
    },
  ],
};
