# TURN do Potato Chat

O coturn está instalado na VPS do acesso SSH `vps`, em Ubuntu 24.04. O endereço configurado é `turn-potato.191-252-178-205.sslip.io`. Esse nome usa DNS automático para o IP da VPS; pode ser substituído por um domínio próprio apontado para o mesmo IP.

Transporte disponível:

- UDP e TCP: porta 3478.
- TLS: porta 5349, com certificado Let's Encrypt e renovação automática.
- Relay de mídia: UDP 49160–49200.

O serviço é `coturn`. A configuração está em `/etc/turnserver.conf`; o segredo compartilhado está em `/etc/potato-turn.secret`, com acesso restrito. O hook `/etc/letsencrypt/renewal-hooks/deploy/potato-turn` atualiza os certificados usados pelo serviço. O vhost Nginx `potato-turn` atende somente à validação do certificado.

O script [setup-turn.sh](setup-turn.sh) instala o serviço e configura um vhost independente. Não altera os vhosts dos outros aplicativos. A porta 443 continua com o Nginx existente. Redes que permitem apenas saída na porta 443 podem continuar bloqueando este TURN.

## Integração

PHP: publique o arquivo privado `versao-php/site/turn.config.php` junto com a atualização do site, no mesmo diretório de `config.php`. Ele foi criado localmente e está ignorado pelo Git. O exemplo público está em `turn.config.example.php`. A regra `.htaccess` bloqueia acesso HTTP direto ao arquivo privado.

Node: a configuração privada fica no `.env`, pelas variáveis `TURN_URLS`, `TURN_SECRET`, `TURN_TTL` e `TURN_ONLY`. Também são aceitos `TURN_USERNAME` e `TURN_PASSWORD` para provedores com credenciais fixas.

A API autenticada (`api.php?action=rtc-config` ou `/api/rtc-config`) gera credenciais HMAC-SHA1 coturn REST com validade de uma hora. O segredo não é enviado ao cliente. O cliente renova as credenciais e negocia novo ICE antes do vencimento. Uma falha temporária da API preserva a configuração anterior.

Falhas de mídia tentam recuperação por até dois minutos, com renovação de credenciais e ICE restart. Quem ligou cria as ofertas, evitando colisões. O PHP mantém as conexões em chamada por três minutos sem sinal de vida, para permitir troca de rede e reconexão do polling. Isso não garante continuidade sem internet ou quando o sistema encerra o processo do aplicativo.

## Verificação

`npm run test:rtc` verifica credenciais, reconexão, respostas duplicadas, timeout e encerramento da captura pela ponte Android. `npm test` e `npm --prefix versao-php test` verificam a sinalização e o restante do chat; o segundo precisa de MySQL local conforme o LEIA-ME.

`npm run test:turn` usa Chromium e `playwright-core` para forçar relay, transmitir vídeo e dados e executar ICE restart por UDP, TCP e TLS. `PLAYWRIGHT_MODULE` pode apontar para `playwright-core/index.mjs`, e `CHROME_PATH` para o Chromium local. Os três transportes foram validados na VPS.

O APK foi compilado e verificado pelo Android Lint. A validação de captura/PiP em aparelho continua necessária: o emulador deste ambiente permaneceu offline e não foi possível executar o teste nativo.
