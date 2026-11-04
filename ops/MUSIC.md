# Biblioteca de músicas (spotDL)

`/playl nome da música` ou `/playl https://open.spotify.com/track/...` usa a biblioteca da VPS. `/play` mantém o comportamento anterior. São aceitas faixas individuais de até 20 minutos.

O PHP agenda o pedido sem esperar o download. A interface mostra o preparo e insere a faixa na fila compartilhada quando estiver pronta. `/pause`, `/skip`, a barra de posição e o volume usam o mesmo player. `/stop` cancela a entrada dos pedidos pendentes daquela conversa; arquivos já baixados continuam na biblioteca.

O serviço usa spotDL 4.6.0 para identificar e baixar, FFmpeg para gerar MP3 e Node.js para o resolvedor normal do yt-dlp. O cache considera o ID do Spotify e o ISRC. Repetir uma consulta ou enviar o link de uma faixa identificada reaproveita o MP3. Um nome diferente pode precisar de nova identificação, mas não baixa novamente a mesma faixa.

## VPS

Requer Debian/Ubuntu com Python 3, venv, FFmpeg, Node.js 22+, Nginx, Certbot e um domínio apontado para a VPS. Copie `server.py`, `download.py` e `setup.sh` de `ops/music-service/` para `/opt/potato-music/`, normalize as quebras de linha e execute:

```sh
bash /opt/potato-music/setup.sh music-potato.191-252-178-205.sslip.io
```

O serviço `potato-music` escuta somente em `127.0.0.1:8787`. O Nginx oferece HTTPS e mantém o certificado com renovação automática. O usuário de sistema tem acesso de escrita apenas à biblioteca, `/var/lib/potato-music`. O SQLite guarda trabalhos e metadados; os arquivos ficam como `<spotify-id>.mp3`.

Há um download por vez, limite padrão de 2 GiB de biblioteca, 12 trabalhos simultaneamente pendentes, 4 minutos por download e 20 minutos de validade do pedido. `MUSIC_MAX_BYTES` em `/etc/potato-music.env` ajusta o limite de armazenamento. A API exige uma chave privada; os players recebem apenas links de áudio assinados, válidos por sete dias, com suporte a Range. A chave nunca vai para o JavaScript. Use os downloads de acordo com as permissões das músicas e dos provedores.

```sh
systemctl status potato-music
journalctl -u potato-music --since '10 minutes ago'
systemctl restart potato-music
```

Ao atualizar os arquivos Python, reinicie o serviço. Downloads interrompidos são retomados como novos trabalhos após o reinício.

## Site e deploy

O arquivo ignorado `versao-php/site/music.config.php` retorna `music_local_url` (HTTPS público) e `music_local_key` (mesma chave da VPS). Não o adicione ao Git. O Secret GitHub `POTATO_MUSIC_CONFIG_B64` contém esse PHP em Base64; `ops/prepare-music-config.py` o gera no runner antes do FTP. `.htaccess` impede acesso HTTP ao arquivo. O deploy do site continua Git → Actions → FTP; o serviço de áudio roda separadamente na VPS.

## Validação

`python tests/music-service.py` verifica autenticação, cache, erros e Range. `npm --prefix versao-php test` verifica a integração PHP/MySQL com o serviço simulado. `npm run test:local-music`, com Playwright e Chrome configurados, reproduz áudio real e verifica pausa, posição, volume, troca de faixa e descarte do player anterior.
