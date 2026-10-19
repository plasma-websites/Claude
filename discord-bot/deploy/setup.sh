#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu server (e.g. Vultr). Run as root from the
# discord-bot folder:  sudo bash deploy/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BOT_DIR="$(pwd)"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id ordersbot >/dev/null 2>&1 || useradd --system --home "$BOT_DIR" --shell /usr/sbin/nologin ordersbot

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env — fill it in (nano $BOT_DIR/.env), then run this script again."
  exit 1
fi

npm ci --omit=dev
mkdir -p data
chown -R ordersbot:ordersbot "$BOT_DIR"
chmod 600 .env

sudo -u ordersbot node --env-file=.env src/deploy-commands.js

sed "s#__BOT_DIR__#$BOT_DIR#g" deploy/orders-bot.service > /etc/systemd/system/orders-bot.service
systemctl daemon-reload
systemctl enable --now orders-bot
systemctl restart orders-bot
sleep 3
systemctl --no-pager status orders-bot | head -5
echo "Done. Logs: journalctl -u orders-bot -f"
