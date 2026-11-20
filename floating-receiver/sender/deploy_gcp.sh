#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR=${1:-/tmp}
APP_DIR=/opt/floating-receiver-sender
DATA_DIR=/var/lib/floating-receiver
ENV_FILE=/etc/floating-receiver.env
SERVICE_FILE=/etc/systemd/system/floating-receiver.service

if ! id -u floating-receiver >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin floating-receiver
fi

install -d -m 0755 "$APP_DIR"
install -d -m 0750 -o floating-receiver -g floating-receiver "$DATA_DIR"
install -m 0644 "$SOURCE_DIR/app.py" "$APP_DIR/app.py"
install -m 0644 "$SOURCE_DIR/requirements.txt" "$APP_DIR/requirements.txt"

if [ ! -x "$APP_DIR/.venv/bin/python" ] || ! "$APP_DIR/.venv/bin/python" -m pip --version >/dev/null 2>&1; then
  rm -rf "$APP_DIR/.venv"
  apt-get update
  apt-get install -y python3-venv
  python3 -m venv "$APP_DIR/.venv"
fi
"$APP_DIR/.venv/bin/python" -m pip install --disable-pip-version-check -q -r "$APP_DIR/requirements.txt"

if [ ! -f "$ENV_FILE" ]; then
  umask 077
  printf 'RECEIVER_TOKEN=%s\nDATABASE_PATH=%s/messages.db\nMAX_MESSAGES=50\n' \
    "$(openssl rand -hex 24)" "$DATA_DIR" > "$ENV_FILE"
fi
chmod 0600 "$ENV_FILE"

cat > "$SERVICE_FILE" <<'EOF'
[Unit]
Description=Floating Receiver message service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=floating-receiver
Group=floating-receiver
WorkingDirectory=/opt/floating-receiver-sender
EnvironmentFile=/etc/floating-receiver.env
ExecStart=/opt/floating-receiver-sender/.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8765
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/floating-receiver

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable floating-receiver.service >/dev/null
systemctl restart floating-receiver.service

for _ in $(seq 1 20); do
  if python3 -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8765/health", timeout=2)' >/dev/null 2>&1; then
    echo "floating-receiver service is healthy"
    exit 0
  fi
  sleep 1
done

systemctl status floating-receiver.service --no-pager
exit 1
