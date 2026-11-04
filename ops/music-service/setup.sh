#!/usr/bin/env bash
set -euo pipefail
domain="${1:-music-potato.191-252-178-205.sslip.io}"
[[ "$domain" =~ ^[a-z0-9.-]+$ ]] || exit 1
install -d /opt/potato-music /var/www/potato-music
command -v ffmpeg >/dev/null || { apt-get update -qq; apt-get install -y ffmpeg python3-venv; }
command -v node >/dev/null || { echo 'Instale Node.js 22+ para o resolvedor de áudio do yt-dlp.' >&2; exit 1; }
test -x /opt/potato-music/venv/bin/python || python3 -m venv /opt/potato-music/venv
/opt/potato-music/venv/bin/pip install --disable-pip-version-check 'spotdl==4.6.0'
id potato-music >/dev/null 2>&1 || useradd --system --home-dir /var/lib/potato-music --create-home --shell /usr/sbin/nologin potato-music
install -d -o potato-music -g potato-music -m 0750 /var/lib/potato-music
if ! test -f /etc/potato-music.env; then
  umask 077
  printf 'MUSIC_API_KEY=%s\nMUSIC_PUBLIC_URL=https://%s\nMUSIC_LIBRARY=/var/lib/potato-music\n' "$(openssl rand -hex 32)" "$domain" > /etc/potato-music.env
fi
cat > /etc/systemd/system/potato-music.service <<'UNIT'
[Unit]
Description=Potato Chat spotDL music library
After=network-online.target
Wants=network-online.target
[Service]
User=potato-music
Group=potato-music
WorkingDirectory=/var/lib/potato-music
EnvironmentFile=/etc/potato-music.env
Environment=HOME=/var/lib/potato-music
ExecStart=/opt/potato-music/venv/bin/python /opt/potato-music/server.py
Restart=on-failure
RestartSec=5
Nice=10
MemoryMax=900M
CPUQuota=100%
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/potato-music
UMask=0027
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/nginx/sites-available/potato-music <<NGINX
server {
    listen 80;
    server_name $domain;
    location /.well-known/acme-challenge/ { root /var/www/potato-music; }
    location / { return 503; }
}
NGINX
ln -sf /etc/nginx/sites-available/potato-music /etc/nginx/sites-enabled/potato-music
nginx -t && systemctl reload nginx
if ! test -f "/etc/letsencrypt/live/$domain/fullchain.pem"; then
  certbot certonly --webroot -w /var/www/potato-music -d "$domain" --non-interactive --agree-tos --register-unsafely-without-email
fi
cat > /etc/nginx/sites-available/potato-music <<NGINX
server {
    listen 80;
    server_name $domain;
    location /.well-known/acme-challenge/ { root /var/www/potato-music; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    server_name $domain;
    ssl_certificate /etc/letsencrypt/live/$domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;
    client_max_body_size 16k;
    access_log off;
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_connect_timeout 3s;
        proxy_read_timeout 60s;
        proxy_buffering off;
        proxy_set_header Host \$host;
    }
}
NGINX
systemctl daemon-reload
systemctl enable --now potato-music
install -d /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/potato-music <<'HOOK'
#!/bin/sh
nginx -t && systemctl reload nginx
HOOK
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/potato-music
nginx -t && systemctl reload nginx
printf 'Biblioteca de música instalada em https://%s\n' "$domain"
