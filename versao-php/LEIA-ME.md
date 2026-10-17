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
| Um visual só | Temas (Escuro, Escuro total, Rosa, Roxo, Azul, Verde e Claro) e papel de parede com foto, salvos na conta de cada um |
| Só texto e emoji | GIFs (busca do GIPHY), fotos, vídeos, áudios e arquivos, direto no campo de mensagem |
| Sem música | Bot de música: `/play` com nome ou link do YouTube ou do Spotify, tocando junto para os dois |

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
2. **Edite `site/config.php`**: preencha o bloco `db`. Nomes e senhas não ficam aqui: cada pessoa escolhe os seus no primeiro acesso. Para os GIFs, coloque também a chave do GIPHY em `giphy_key` (veja [GIFs](#gifs)).
3. **Crie o subdomínio** no painel (ex.: `chat.seudominio.com.br`). O painel mostra a pasta dele, por exemplo `public_html/chat`.
4. **Envie por FTP** (FileZilla, por exemplo) o **conteúdo** de `site/` para essa pasta. `index.php` precisa ficar direto nela, não dentro de outra subpasta `site/`.
   - No FileZilla, ative *Servidor → Forçar exibição de arquivos ocultos* para ver e enviar o `.htaccess`.
   - O modo de transferência automático serve para tudo (o PNG vai em binário).
5. **Ative o SSL (HTTPS)** do subdomínio no painel. Ele é obrigatório para microfone, câmera e transmissão de tela.
6. **Abra o site.** No primeiro acesso as tabelas (prefixo `potato_`) são criadas sozinhas. Se preferir, importe antes o `banco.sql` pelo phpMyAdmin.
7. **Criem as duas contas logo.** As duas primeiras pessoas que entrarem escolhem nome e senha (o site pede a senha duas vezes). Depois disso eles valem para sempre e ninguém mais cria conta. Enquanto sobrar uma vaga, quem abrir o link pode ficar com ela.

Para atualizar o site depois, envie de novo só os arquivos alterados. Os navegadores pegam a versão nova sozinhos, sem precisar limpar o cache. Se o banco veio de uma versão anterior, o que faltar (senha, foto, tema e papel de parede em `potato_users`, GIF em `potato_messages`, a tabela `potato_files` das fotos e arquivos) é criado sozinho no primeiro acesso. Quem já estava registrado sem senha escolhe uma ao entrar de novo.

## Perfil: conta, foto e tema

Foto, tema, notificações, sons e *Sair* ficam juntos na aba **Perfil**, separada da conversa: no computador, em *Ver seu perfil*, no pé da barra lateral; no celular (e no painel da extensão), na sua foto, na barra de baixo. O perfil também mostra quantas mensagens você mandou, quantas reações deu e há quantos dias vocês conversam.

- **Senha:** fica no banco só como *hash* (`pass_hash` na tabela `potato_users`), nunca o texto da senha.
- **Foto:** no Perfil, clique na foto ou em *Trocar foto* e escolha uma imagem. O navegador recorta o centro num quadrado, reduz e envia. GIF animado também vale (até 700 KB): ele vai inteiro, sem recorte, para não perder a animação. A foto fica no banco e aparece para a outra pessoa na conversa, nas chamadas e nas notificações.
- **Tema:** também no Perfil. Cada pessoa escolhe o seu, e ele só muda para ela. A escolha fica na conta (coluna `theme`), então vale em qualquer aparelho em que ela entrar, e as outras abas abertas mudam na hora. O navegador guarda uma cópia para o tema aparecer já na tela de login, sem piscar. No tema Claro, a chamada continua escura, porque o vídeo fica melhor assim.
- **Papel de parede:** no Perfil, em *Escolher foto*. Antes de aplicar, uma prévia com balões de exemplo mostra como fica, com três ajustes: **Iluminação** (do mais escuro ao mais claro), **Desfoque** e **Cor do tema por cima** (mistura a cor do tema na foto, para a conversa combinar). Como o tema, só muda para quem escolheu e vale em todos os aparelhos dela. A foto é reduzida no navegador e fica no banco (colunas `wallpaper*` em `potato_users`). Para mudar só os ajustes, use *Ajustar*; para voltar ao fundo normal, *Remover*.
- **Esqueceu a senha?** No phpMyAdmin, abra a tabela `potato_users`, edite a linha da pessoa e marque `pass_hash` como `NULL`. As sessões dela caem, e no próximo login ela escolhe uma senha nova com o mesmo nome. As mensagens não mudam.

## GIFs

O botão **GIF**, ao lado do campo de mensagem, abre os GIFs em alta e uma busca. Clicou, enviou. A busca é do GIPHY (o Tenor, do Google, desligou a API dele em junho de 2026) e precisa de uma chave grátis:

1. Crie uma conta em [developers.giphy.com](https://developers.giphy.com) e clique em **Create an App** → **API**.
2. Copie a chave (*API Key*) e coloque em `giphy_key` no `config.php`. Envie o `config.php` de novo.

Sem a chave, o botão continua lá, mas avisa que os GIFs ainda não foram ativados. A chave começa como *beta*, com limite de 100 buscas por hora, o que sobra para duas pessoas. Se um dia não bastar, peça a chave de produção no próprio painel do GIPHY.

A busca é feita direto pelo navegador, como o GIPHY pede, então a chave chega a quem está logado no chat (ela foi feita para isso). No banco fica só o endereço do GIF (coluna `media` em `potato_messages`), e o servidor só aceita endereços de imagem do próprio GIPHY.

## Fotos e arquivos

O clipe, ao lado do botão GIF, abre duas opções: **Foto ou vídeo** (no celular, oferece também a câmera) e **Arquivo** (qualquer tipo). Também dá para arrastar arquivos para cima da conversa ou colar uma imagem (um print, por exemplo) no campo de mensagem. A mensagem aparece na hora, com uma barrinha mostrando o envio.

- **Fotos** abrem em tela cheia ao clicar, com botão para baixar. Foto grande é reduzida no navegador antes de subir (lado maior até 2048 px), então chega rápido. GIF vai inteiro.
- **Vídeos e áudios** tocam direto na conversa. **Outros arquivos** aparecem como um cartão com nome e tamanho; clicar baixa.
- **Onde ficam:** no próprio banco, na tabela `potato_files` (nada é gravado em pastas do servidor). Apagar a mensagem apaga o arquivo. Arquivo que subiu mas nunca virou mensagem (envio cancelado no meio) é apagado sozinho depois de um dia.
- **Tamanho máximo:** 10 MB por arquivo, ou menos se a hospedagem limitar. O site confere sozinho o `post_max_size` do PHP e o `max_allowed_packet` do MySQL e usa o menor; quem passar do limite vê o máximo no aviso. Para aceitar arquivos maiores, aumente esses dois valores no painel da hospedagem (até 10 MB).
- **Segurança:** o servidor descobre o tipo pelo conteúdo do arquivo, não pelo nome. Só imagem, vídeo e áudio de verdade abrem dentro do chat; o resto sempre baixa, para que uma página disfarçada nunca rode dentro do site. O endereço de cada arquivo usa uma chave aleatória e só chega a quem está logado.

## Bot de música (/play)

Escreva no campo de mensagem e aperte Enter (ao digitar `/`, aparece a lista dos comandos):

| Comando | O que faz |
| --- | --- |
| `/play nome da música` | Procura no YouTube e toca para os dois |
| `/play link` | Toca um link do YouTube (vídeo, shorts, YouTube Music) ou do Spotify (música, álbum, playlist, podcast) |
| `/play` sozinho | Continua a música pausada |
| `/pause` | Pausa para os dois |
| `/skip` (ou `/pular`) | Pula para a próxima da fila |
| `/stop` (ou `/parar`) | Para e limpa a fila |
| `/fila` | Abre o tocador |

- Se já tiver música tocando, o `/play` coloca a nova **na fila**, que avança sozinha quando cada música acaba.
- Cada pedido aparece na conversa como um cartão do **Potato DJ**, com a capa. Enquanto toca, um ícone com barrinhas dançando fica no **canto superior direito** da conversa; ele abre o tocador, com o vídeo, a barra de tempo (dá para avançar), tocar/pausar, pular, parar, volume (só para você) e a fila (dá para tirar uma música dela).
- **Os dois ouvem a mesma parte ao mesmo tempo.** A fila fica no servidor (na tabela `potato_settings`, sem tabela nova), e cada aparelho acerta o tempo sozinho se ficar mais de 2 segundos fora. Pausar, pular ou avançar vale para os dois, com um aviso para a outra pessoa.
- **Spotify:** toca a música inteira para quem estiver logado no Spotify naquele navegador; sem login, o próprio Spotify só deixa ouvir uma prévia de 30 segundos. Em alguns navegadores é preciso tocar uma vez no ▶ do Spotify, dentro do tocador.
- **Som bloqueado:** se o navegador não deixar a música começar sozinha (acontece quando a pessoa ainda não tocou na página), o ícone ganha um pontinho vermelho e o tocador mostra **Toque para ouvir junto**.
- Vídeos cujo dono proíbe tocar fora do YouTube são pulados com um aviso. Na busca pelo nome, eles já ficam de fora.
- **Busca pelo nome:** funciona sem configurar nada (o servidor lê a página de resultados do YouTube). Se um dia ela parar, configure a chave oficial: em [console.cloud.google.com](https://console.cloud.google.com), crie um projeto, ative a **YouTube Data API v3**, crie uma chave em *Credenciais* e coloque em `youtube_key` no `config.php`. A cota grátis dá cerca de 100 buscas por dia.
- O servidor precisa conseguir acessar a internet (YouTube e Spotify) pelo PHP, o que as hospedagens comuns permitem.

## Chamadas e transmissão de tela

Os botões do topo da conversa ligam por voz, por vídeo ou já transmitindo a tela; durante a chamada, a barra de baixo liga e desliga microfone, câmera e transmissão.

- **Transmitir a tela:** antes de começar, uma janela pergunta a qualidade (*Leve* 720p, *Nítida* 1080p, *Fluida* 1080p a 60 fps) e se o som do que estiver tocando vai junto. Depois o navegador pergunta qual tela, janela ou aba mostrar. Quem transmite vê a própria tela só como uma prévia pequena no canto, com o botão *Parar*; quem assiste vê a transmissão grande, com volume, tela cheia e **janelinha flutuante** (para continuar assistindo enquanto usa outras coisas).
- **No celular dá para assistir, mas não para transmitir:** os navegadores de celular (Chrome no Android, Safari no iPhone) não deixam nenhum site capturar a tela. O botão continua lá e explica isso; para transmitir, use o Chrome, o Edge ou o Firefox no computador.
- **Enquadramento:** cada câmera aparece no formato dela (celular em pé fica em pé), sem cortar o rosto.

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
| `giphy_key` | Chave do GIPHY para a busca de GIFs. Vazio = GIFs desligados |
| `youtube_key` | Opcional: chave da YouTube Data API para o `/play` buscar pelo nome do jeito oficial. Vazio = busca pela página de resultados do YouTube |

## Problemas comuns

- **"Não foi possível conectar ao banco de dados"**: confira os dados de `db` no `config.php`. Em algumas hospedagens o nome do banco e o do usuário têm um prefixo, como `u123456_potato`.
- **"A extensão pdo_mysql do PHP não está ativada"**: ative-a no painel (*Selecionar versão do PHP → Extensões*).
- **Mensagens demorando ou caindo a conexão**: diminua `poll_wait` (por exemplo para `10`) ou use `0`.
- **`/play` diz que não achou nada, mas com link funciona** (ou nem o título aparece): o PHP da hospedagem não está conseguindo acessar o YouTube. Confira se a hospedagem libera conexões de saída (cURL) e, se o PHP reclamar de certificado SSL, peça ao suporte para configurar o `curl.cainfo`. Configurar a `youtube_key` também ajuda.
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
- Fotos e arquivos: até 10 MB cada (ou o limite da hospedagem, se for menor). Ficam no banco, então ocupam o espaço do MySQL do plano.
