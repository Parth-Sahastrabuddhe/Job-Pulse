module.exports = {
  apps: [
    {
      name: "micro-bot",
      script: "src/index.js",
      args: "--watch",
      cwd: "/home/ubuntu/Job-Pulse",
      ignore_watch: ["data", "node_modules", ".git", "web"],
      instances: 1,
      exec_mode: "fork",
      min_uptime: "30s",
      restart_delay: 5000,
      exp_backoff_restart_delay: 10000,
      kill_timeout: 10000,
      max_memory_restart: "350M",
      time: true,
      env: { NODE_ENV: "production" }
    },
    {
      name: "jobpulse-mu",
      script: "src/multi-user.js",
      cwd: "/home/ubuntu/Job-Pulse",
      instances: 1,
      exec_mode: "fork",
      min_uptime: "30s",
      restart_delay: 5000,
      exp_backoff_restart_delay: 10000,
      kill_timeout: 10000,
      max_memory_restart: "350M",
      time: true,
      env: { NODE_ENV: "production" }
    },
    {
      name: "jobpulse-web",
      script: "node_modules/.bin/next",
      args: "start --hostname 127.0.0.1 --port 3000",
      cwd: "/home/ubuntu/Job-Pulse/web",
      instances: 1,
      exec_mode: "fork",
      min_uptime: "30s",
      restart_delay: 5000,
      exp_backoff_restart_delay: 10000,
      kill_timeout: 10000,
      max_memory_restart: "450M",
      time: true,
      env: { NODE_ENV: "production", TRUST_PROXY: "nginx" }
    }
  ]
};
