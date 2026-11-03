# TURN do Potato Chat

O coturn está instalado na VPS do acesso SSH `vps`, em Ubuntu 24.04. O endereço configurado é `turn-potato.191-252-178-205.sslip.io`. Esse nome usa DNS automático para o IP da VPS; pode ser substituído por um domínio próprio apontado para o mesmo IP.

Transporte disponível:

- UDP e TCP: porta 3478.
- TLS: porta 5349, com certificado Let's Encrypt e renovação automática.
- Relay de mídia: UDP 49160–49200.

O serviço é `coturn`. A configuração está em `/etc/turnserver.conf`; o segredo compartilhado está em `/etc/potato-turn.secret`, com acesso restrito. O hook `/etc/letsencrypt/renewal-hooks/deploy/potato-turn` atualiza os certificados usados pelo serviço. O vhost Nginx `potato-turn` atende somente à validação do certificado.

O script [setup-turn.sh](setup-turn.sh) instala o serviço e configura um vhost independente. Não altera os vhosts dos outros aplicativos. A porta 443 continua com o Nginx existente. Redes que permitem apenas saída na porta 443 podem continuar bloqueando este TURN.

## Integração

PHP: o fluxo de produção é **Git → GitHub Actions → FTP**. O Secret `POTATO_TURN_CONFIG_B64` guarda o conteúdo de `turn.config.php` codificado em Base64. O workflow executa `ops/prepare-turn-config.py` para gerar esse arquivo no runner antes de enviar o site para `/public_html/potato/`. Se o Secret estiver ausente ou inválido, o deploy para com uma mensagem de erro, evitando publicar a atualização sem TURN. Não é necessário ZIP nem envio manual.

O arquivo privado `versao-php/site/turn.config.php` continua ignorado pelo Git; o segredo do coturn não entra nos commits. O exemplo público está em `turn.config.example.php`. A regra `.htaccess` bloqueia acesso HTTP direto ao arquivo privado. Para atualizar o Secret, codifique o conteúdo do arquivo privado em Base64 e salve-o em **Settings → Secrets and variables → Actions → POTATO_TURN_CONFIG_B64**. Base64 só codifica o conteúdo; a proteção vem do armazenamento como Secret do GitHub.

Node: a configuração privada fica no `.env`, pelas variáveis `TURN_URLS`, `TURN_SECRET`, `TURN_TTL` e `TURN_ONLY`. Também são aceitos `TURN_USERNAME` e `TURN_PASSWORD` para provedores com credenciais fixas.

A API autenticada (`api.php?action=rtc-config` ou `/api/rtc-config`) gera credenciais HMAC-SHA1 coturn REST com validade de uma hora. O segredo não é enviado ao cliente. O cliente renova as credenciais e negocia novo ICE antes do vencimento. Uma falha temporária da API preserva a configuração anterior.

Falhas de mídia tentam recuperação por até dois minutos, com renovação de credenciais e ICE restart. Quem ligou cria as ofertas, evitando colisões. Ao sair ou perder a conexão, o PHP desprende o participante e mantém a sala disponível por cinco minutos; ao retornar, o cliente reconecta à mesma sala. Conexões antigas e avisos de saída atrasados não podem retirar uma reentrada mais recente. O prazo é conferido no servidor em cada consulta, inclusive antes de aceitar uma entrada.

## Verificação

`npm run test:rtc` verifica credenciais, reconexão, respostas duplicadas, timeout e encerramento da captura pela ponte Android. `npm test` e `npm --prefix versao-php test` verificam a sinalização e o restante do chat; o segundo precisa de MySQL local conforme o LEIA-ME.

`npm run test:call-rejoin` usa PHP/MySQL locais e Chromium com microfone sintético. Confere recarga dos dois lados, logout/login, reentrada manual, microfone silenciado, abas simultâneas, ofertas e saídas atrasadas, prazo de cinco minutos e encerramento definitivo. Usa as mesmas variáveis `POTATO_TEST_DB_*`, `PLAYWRIGHT_MODULE` e `CHROME_PATH` dos demais testes.

`npm run test:turn` usa Chromium e `playwright-core` para forçar relay, transmitir vídeo e dados e executar ICE restart por UDP, TCP e TLS. `PLAYWRIGHT_MODULE` pode apontar para `playwright-core/index.mjs`, e `CHROME_PATH` para o Chromium local. Os três transportes foram validados na VPS.

O APK foi compilado e verificado pelo Android Lint. A validação de captura/PiP em aparelho continua necessária: o emulador deste ambiente permaneceu offline e não foi possível executar o teste nativo.
