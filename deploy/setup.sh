#!/bin/bash
# JobPulse Multi-User Platform Deployment
# Run on the EC2 instance after git pull

set -e

echo "=== JobPulse Deployment ==="

cd /home/ubuntu/Job-Pulse

# Install bot dependencies
echo "Installing bot dependencies..."
npm install --production

# Install web dependencies and build
echo "Installing web dependencies..."
cd web
# Full install (including devDependencies): the Tailwind v4 PostCSS plugin that
# `next build` loads via postcss.config.mjs lives in devDependencies, so
# --production would omit it and break the build on a clean machine.
npm ci
echo "Building Next.js..."
npm run build
cd ..

# Seed H1B sponsors (idempotent)
echo "Seeding H1B sponsors..."
node src/h1b-sponsors-seed.js

# Nginx setup
if [ -f deploy/nginx.conf ]; then
  echo "Setting up Nginx..."
  sudo cp deploy/nginx.conf /etc/nginx/sites-available/jobpulse
  sudo ln -sf /etc/nginx/sites-available/jobpulse /etc/nginx/sites-enabled/
  sudo nginx -t && sudo systemctl reload nginx
fi

# pm2 setup
echo "Starting pm2 processes..."
pm2 start deploy/ecosystem.config.cjs
pm2 save

echo ""
echo "=== Deployment complete ==="
echo "Micro-Bot:    pm2 logs micro-bot"
echo "JobPulse MU:  pm2 logs jobpulse-mu"
echo "Website:      pm2 logs jobpulse-web"
echo ""
echo "For SSL: sudo certbot --nginx -d jobpulse.app -d www.jobpulse.app"
