// PM2 ecosystem for VPS deployment
// Usage: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'karaya-api',
      script: 'src/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      out_file: 'logs/out.log',
      error_file: 'logs/err.log',
      time: true,
    },
  ],
}
