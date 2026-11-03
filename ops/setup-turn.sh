#!/usr/bin/env bash
# Uso: sudo bash setup-turn.sh turn.seudominio.com
# O DNS precisa apontar para esta VPS. Instala somente coturn e um vhost ACME independente.
set -euo pipefail
domain=${1:?Informe o domínio do TURN}
[[ $EUID == 0 && $domain =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+$ ]] || exit 1
command -v nginx >/dev/null
command -v certbot >/dev/null
if ! command -v turnserver >/dev/null; then
  systemctl mask coturn
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y coturn
fi
install -d -m 755 /var/www/potato-turn/.well-known/acme-challenge
vhost=/etc/nginx/sites-available/potato-turn
if [[ -e $vhost ]] && ! grep -q '# Managed by PotatoChat TURN setup' "$vhost"; then
  echo 'Já existe um vhost potato-turn não gerenciado por este script.' >&2; exit 1
fi
cat > "$vhost" <<EOF
# Managed by PotatoChat TURN setup
server {
    listen 80;
    server_name $domain;
    root /var/www/potato-turn;
    location /.well-known/acme-challenge/ { try_files \$uri =404; }
    location / { return 404; }
}
EOF
ln -sfn "$vhost" /etc/nginx/sites-enabled/potato-turn
nginx -t
systemctl reload nginx
certbot certonly --webroot -w /var/www/potato-turn -d "$domain" --non-interactive --agree-tos --register-unsafely-without-email
install -d -m 750 -o root -g turnserver /etc/coturn/potato
if [[ ! -s /etc/potato-turn.secret ]]; then
  (umask 077; openssl rand -hex 32 > /etc/potato-turn.secret)
fi
secret=$(cat /etc/potato-turn.secret)
address=$(ip -4 -o addr show scope global | awk '{split($4,a,"/"); print a[1]; exit}')
if [[ -f /etc/turnserver.conf && ! -f /etc/turnserver.conf.before-potato ]]; then cp -a /etc/turnserver.conf /etc/turnserver.conf.before-potato; fi
cat > /etc/turnserver.conf <<EOF
# Managed by PotatoChat TURN setup
listening-port=3478
tls-listening-port=5349
listening-ip=$address
relay-ip=$address
min-port=49160
max-port=49200
realm=$domain
fingerprint
use-auth-secret
static-auth-secret=$secret
cert=/etc/coturn/potato/fullchain.pem
pkey=/etc/coturn/potato/privkey.pem
no-tlsv1
no-tlsv1_1
no-cli
no-multicast-peers
no-tcp-relay
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
user-quota=32
total-quota=64
max-bps=2000000
bps-capacity=128000000
stale-nonce=600
no-stdout-log
log-file=syslog
EOF
chown root:turnserver /etc/turnserver.conf
chmod 640 /etc/turnserver.conf
cat > /etc/letsencrypt/renewal-hooks/deploy/potato-turn <<EOF
#!/usr/bin/env bash
set -eu
install -m 640 -o root -g turnserver /etc/letsencrypt/live/$domain/fullchain.pem /etc/coturn/potato/fullchain.pem
install -m 640 -o root -g turnserver /etc/letsencrypt/live/$domain/privkey.pem /etc/coturn/potato/privkey.pem
systemctl try-restart coturn
EOF
chmod 750 /etc/letsencrypt/renewal-hooks/deploy/potato-turn
/etc/letsencrypt/renewal-hooks/deploy/potato-turn
systemctl unmask coturn
systemctl enable --now coturn
systemctl restart coturn
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 3478/udp comment 'Potato TURN UDP'
  ufw allow 3478/tcp comment 'Potato TURN TCP'
  ufw allow 5349/tcp comment 'Potato TURN TLS'
  ufw allow 49160:49200/udp comment 'Potato TURN media'
fi
systemctl is-active coturn
echo "TURN pronto: turn:$domain:3478?transport=udp,turn:$domain:3478?transport=tcp,turns:$domain:5349?transport=tcp"
echo 'Segredo armazenado em /etc/potato-turn.secret (não publique este arquivo).'
