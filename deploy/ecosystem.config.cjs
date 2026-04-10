module.exports = {
  apps: [
    {
      name: "micro-bot",
      script: "src/index.js",
      args: "--watch",
      cwd: "/home/ubuntu/Job-Pulse",
      ignore_watch: ["data", "node_modules", ".git", "web"],
      env: { NODE_ENV: "production" }
    },
    {
      name: "jobpulse-mu",
      script: "src/multi-user.js",
      cwd: "/home/ubuntu/Job-Pulse",
      env: { NODE_ENV: "production" }
    },
    {
      name: "jobpulse-web",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/home/ubuntu/Job-Pulse/web",
      env: { NODE_ENV: "production", PORT: "3000" }
    }
  ]
};
