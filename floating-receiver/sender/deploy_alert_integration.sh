#!/usr/bin/env bash
set -euo pipefail

SOURCE=${1:-/tmp/binance-alert-daemon.cjs}
TARGET=/opt/quantum-alert/dist-alert/binance-alert-daemon.cjs
DROP_IN_DIR=/etc/systemd/system/quantum-binance-alert.service.d

test -f "$SOURCE"
test -f "$TARGET"
test -f /etc/floating-receiver.env

cp -a "$TARGET" "$TARGET.before-floating-receiver.bak"
install -m 0644 "$SOURCE" "$TARGET"
install -d -m 0755 "$DROP_IN_DIR"

cat > "$DROP_IN_DIR/floating-receiver.conf" <<'EOF'
[Service]
EnvironmentFile=/etc/floating-receiver.env
Environment=FLOATING_RECEIVER_URL=http://127.0.0.1:8765/api/messages
EOF

systemctl daemon-reload
systemctl restart quantum-binance-alert.service
sleep 3
systemctl is-active quantum-binance-alert.service
journalctl -u quantum-binance-alert.service --since=-1min --no-pager -n 40
