// pm2 config for the /add automation runner. Runs on the DEV box (where the
// claude CLI is authenticated), NOT on EC2.
//
// Enable:  pm2 start automation/ecosystem.add-runner.config.cjs && pm2 save
// Disable: pm2 delete jobpulse-add-runner && pm2 save
//
// The runner polls the EC2 company_queue every ADD_RUNNER_POLL_SECONDS and
// processes at most ADD_RUNNER_MAX_PER_PASS items per pass. See
// automation/add-company-runner.mjs for all knobs and safety properties.

const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "jobpulse-add-runner",
      script: path.join(__dirname, "add-company-runner.mjs"),
      cwd: path.join(__dirname, ".."),
      autorestart: true,
      max_memory_restart: "300M",
      restart_delay: 30000,
      env: {
        ADD_RUNNER_POLL_SECONDS: "300",
        ADD_RUNNER_MODEL: "sonnet",
      },
    },
  ],
};
