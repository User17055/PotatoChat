# Potato Chat — versão PHP + MySQL

O mesmo site (mesmo HTML, CSS, animações, sons, chamadas e extensão), adaptado para hospedagem PHP comum, com as mensagens num banco MySQL e envio por FTP para a pasta de um subdomínio.

## O que mudou em relação à versão Node

| Antes (Node) | Agora (PHP) |
| --- | --- |
| Express serve a página | `index.php` serve o mesmo HTML |
| Socket.IO (WebSocket) | `realtime.js` + `api.php`: HTTP com *long polling*. O `app.js` continua usando `socket.on` e `socket.emit`, como antes |
| `data/messages.json` (500 mensagens) | Tabelas MySQL, com histórico completo e paginado de 60 em 60 |
| `.env` | `site/config.php` (só os dados do banco) |
| Uma senha da sala para os dois | Cada pessoa tem nome e senha próprios, guardados no banco |
| Avatar com a inicial do nome | Foto de perfil, que cada um escolhe e troca quando quiser |
| Um visual só | Temas (Escuro, Escuro total, Rosa, Roxo, Azul, Verde e Claro), salvos na conta de cada um |

As sessões têm o mesmo formato da versão Node. Se o chat continuar no mesmo endereço e com a mesma `token_secret`, ninguém precisa entrar de novo.

## Pastas

```
versao-php/
├── site/          ← envie o CONTEÚDO desta pasta por FTP para a pasta do subdomínio
│   ├── index.php      página do chat
│   ├── api.php        API (login, mensagens, presença, sinalização das chamadas)
│   ├── config.php     dados do MySQL  ← edite antes de enviar
│   ├── realtime.js    conexão em tempo real (substitui o Socket.IO)
│   ├── app.js, fx.js, sound.js, styles.css, img/, vendor/
│   ├── lib/           código do servidor (bloqueado para o navegador)
│   └── .htaccess      protege config.php e lib/ (arquivo oculto: não esqueça de enviar)
├── extensao/      ← extensão do Chrome adaptada (carregue no Chrome, não vai para o servidor)
├── banco.sql      ← opcional: tabelas para importar pelo phpMyAdmin
└── tests/         ← teste automático (só para o seu computador)
```

## Publicar (FTP + MySQL)

1. **Crie o banco MySQL** no painel da hospedagem (cPanel → *Bancos de dados MySQL*, ou hPanel → *Bancos de Dados*). Anote o nome do banco, o usuário, a senha e o host (quase sempre `localhost`).
2. **Edite `site/config.php`**: preencha o bloco `db`. Nomes e senhas não ficam aqui: cada pessoa escolhe os seus no primeiro acesso.
3. **Crie o subdomínio** no painel (ex.: `chat.seudominio.com.br`). O painel mostra a pasta dele, por exemplo `public_html/chat`.
4. **Envie por FTP** (FileZilla, por exemplo) o **conteúdo** de `site/` para essa pasta. `index.php` precisa ficar direto nela, não dentro de outra subpasta `site/`.
   - No FileZilla, ative *Servidor → Forçar exibição de arquivos ocultos* para ver e enviar o `.htaccess`.
   - O modo de transferência automático serve para tudo (o PNG vai em binário).
5. **Ative o SSL (HTTPS)** do subdomínio no painel. Ele é obrigatório para microfone, câmera e transmissão de tela.
6. **Abra o site.** No primeiro acesso as tabelas (prefixo `potato_`) são criadas sozinhas. Se preferir, importe antes o `banco.sql` pelo phpMyAdmin.
7. **Criem as duas contas logo.** As duas primeiras pessoas que entrarem escolhem nome e senha (o site pede a senha duas vezes). Depois disso eles valem para sempre e ninguém mais cria conta. Enquanto sobrar uma vaga, quem abrir o link pode ficar com ela.

Para atualizar o site depois, envie de novo só os arquivos alterados. Os navegadores pegam a versão nova sozinhos, sem precisar limpar o cache. Se o banco veio de uma versão anterior, as colunas novas (senha, foto e tema) são acrescentadas sozinhas no primeiro acesso. Quem já estava registrado sem senha escolhe uma ao entrar de novo.

## Contas, foto e tema

- **Senha:** fica no banco só como *hash* (`pass_hash` na tabela `potato_users`), nunca o texto da senha.
- **Foto:** clique no seu nome na barra lateral (no celular, no seu avatar no topo) e escolha uma imagem. O navegador recorta o centro num quadrado, reduz e envia. A foto fica no banco e aparece para a outra pessoa na conversa, nas chamadas e nas notificações.
- **Tema:** na mesma janela da foto (ou em *Tema*, na barra lateral). Cada pessoa escolhe o seu, e ele só muda para ela. A escolha fica na conta (coluna `theme`), então vale em qualquer aparelho em que ela entrar, e as outras abas abertas mudam na hora. O navegador guarda uma cópia para o tema aparecer já na tela de login, sem piscar. No tema Claro, a chamada continua escura, porque o vídeo fica melhor assim.
- **Esqueceu a senha?** No phpMyAdmin, abra a tabela `potato_users`, edite a linha da pessoa e marque `pass_hash` como `NULL`. As sessões dela caem, e no próximo login ela escolhe uma senha nova com o mesmo nome. As mensagens não mudam.

**Requisitos:** PHP 7.4 ou superior com a extensão `pdo_mysql` (vem ativa em praticamente todas as hospedagens), e MySQL 5.6+ ou MariaDB 10.1+.

## Extensão do Chrome

1. Em `chrome://extensions`, ative o **Modo do desenvolvedor** e clique em **Carregar sem compactação**. Escolha a pasta `extensao/`. Se a versão antiga estiver instalada, remova-a antes.
2. Nas opções da extensão, coloque o endereço do site (ex.: `https://chat.seudominio.com.br`) e clique em **Testar conexão**.

Os atalhos continuam iguais: botão direito → *Enviar para o nosso chat*, `pc` + Espaço na barra de endereço, e `Alt+Shift+O`.

## Configurações (`config.php`)

| Chave | Para que serve |
| --- | --- |
| `db` | Host, porta, nome, usuário, senha e prefixo das tabelas do MySQL |
| `token_secret` | Chave das sessões. Vazio = gerada uma vez e guardada no banco |
| `poll_wait` | Segundos que cada consulta espera por novidades (padrão 20). Use `0` se a hospedagem derrubar requisições demoradas: o chat passa a consultar a cada 1,5 s |

## Problemas comuns

- **"Não foi possível conectar ao banco de dados"**: confira os dados de `db` no `config.php`. Em algumas hospedagens o nome do banco e o do usuário têm um prefixo, como `u123456_potato`.
- **"A extensão pdo_mysql do PHP não está ativada"**: ative-a no painel (*Selecionar versão do PHP → Extensões*).
- **Mensagens demorando ou caindo a conexão**: diminua `poll_wait` (por exemplo para `10`) ou use `0`.
- **Servidor Nginx sem `.htaccess`**: bloqueie o acesso à pasta `lib/` na configuração do Nginx. O `config.php` já não mostra nada quando aberto no navegador.

## Testar no seu computador

Com o MySQL do XAMPP ligado, crie um banco, ajuste o `config.php` e rode:

```powershell
php -S localhost:8000 -t site
```

Depois abra `http://localhost:8000`. O servidor embutido do PHP atende uma requisição por vez, então nele o chat usa consultas curtas automaticamente. Na hospedagem, ele usa *long polling*.

Teste automático (Node 20+ e PHP no PATH): `npm test`. Por padrão ele usa o MySQL em `127.0.0.1:3399`, banco `potato_teste`, usuário `potato`, senha `senha-teste`. Para usar outro, defina `POTATO_TEST_DB_HOST`, `_PORT`, `_NAME`, `_USER` e `_PASS`. Ele cria tabelas com um prefixo próprio e as apaga no fim.

## Limites

- Uma sala, só duas pessoas. Cada pessoa pode ter várias abas, aparelhos e a extensão conectados.
- Cada aba aberta mantém uma requisição PHP esperando por até `poll_wait` segundos. Para duas pessoas isso é pouco, mas planos muito limitados podem pedir um `poll_wait` menor.
- As chamadas usam WebRTC com servidores STUN públicos. Redes muito restritas podem precisar de um servidor TURN.
