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
| Só texto e emoji | GIFs (busca do GIPHY), fotos, vídeos, áudios e arquivos, direto no campo de mensagem, e mensagens de voz gravadas no chat |
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
│   ├── lib/           código do servidor (bloqueado para o navegador); as cartas dos joguinhos ficam em lib/jogos.php
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

Foto, tema, notificações, sons e *Sair* ficam juntos na aba **Perfil**, separada da conversa: no computador, em *Ver seu perfil*, no pé da barra lateral; no celular (e no painel da extensão), no **botão de menu** (☰) do canto de cima, que abre a mesma barra lateral (a conversa fica no topo dela e o seu perfil, no pé; o pontinho vermelho do botão acende quando chega mensagem com você fora da conversa). O perfil também mostra quantas mensagens você mandou, quantas reações deu e há quantos dias vocês conversam.

- **Perfil da outra pessoa:** tocar no nome ou na foto dela, no topo da conversa, abre o perfil dela: a foto (toque para ampliar), o status ao vivo ("online agora", "digitando…", "Visto por último…"), quantas mensagens ela mandou, quantas reações deu, há quantos dias vocês conversam e atalhos para chamada de voz, de vídeo ou para escrever.
- **Senha:** fica no banco só como *hash* (`pass_hash` na tabela `potato_users`), nunca o texto da senha.
- **Foto:** no Perfil, clique na foto ou em *Trocar foto* e escolha uma imagem. O navegador recorta o centro num quadrado, reduz e envia. GIF animado também vale (até 700 KB): ele vai inteiro, sem recorte, para não perder a animação. A foto fica no banco e aparece para a outra pessoa na conversa, nas chamadas e nas notificações.
- **Tema:** também no Perfil. Cada pessoa escolhe o seu, e ele só muda para ela. A escolha fica na conta (coluna `theme`), então vale em qualquer aparelho em que ela entrar, e as outras abas abertas mudam na hora. O navegador guarda uma cópia para o tema aparecer já na tela de login, sem piscar. No tema Claro, a chamada continua escura, porque o vídeo fica melhor assim.
- **Mais temas:** Vinho, Oceano, Coral e **Natal 🎄**. O Natal deixa o site inteiro natalino para quem escolher: neve caindo (com "reduzir movimento" ligado no aparelho, os flocos ficam parados), gorro de Papai Noel em todas as fotos de perfil, luzinhas piscando no topo e as cores vermelho, verde e dourado.
- **Letra e balões da conversa:** no Perfil, embaixo dos temas: a letra (Pequena, Normal, Grande ou Enorme) e o formato dos balões (Arredondados, Bolha ou Retos). Vale só para o aparelho.
- **Papel de parede:** no Perfil, em *Escolher foto*. Antes de aplicar, uma prévia com balões de exemplo mostra como fica, com três ajustes: **Iluminação** (do mais escuro ao mais claro), **Desfoque** e **Cor do tema por cima** (mistura a cor do tema na foto, para a conversa combinar). Como o tema, só muda para quem escolheu e vale em todos os aparelhos dela. A foto é reduzida no navegador e fica no banco (colunas `wallpaper*` em `potato_users`). Para mudar só os ajustes, use *Ajustar*; para voltar ao fundo normal, *Remover*.
- **Esqueceu a senha?** No phpMyAdmin, abra a tabela `potato_users`, edite a linha da pessoa e marque `pass_hash` como `NULL`. As sessões dela caem, e no próximo login ela escolhe uma senha nova com o mesmo nome. As mensagens não mudam.

## GIFs

O botão **GIF**, ao lado do campo de mensagem, abre os GIFs em alta e uma busca. Clicou, enviou. A busca é do GIPHY (o Tenor, do Google, desligou a API dele em junho de 2026) e precisa de uma chave grátis:

1. Crie uma conta em [developers.giphy.com](https://developers.giphy.com) e clique em **Create an App** → **API**.
2. Copie a chave (*API Key*) e coloque em `giphy_key` no `config.php`. Envie o `config.php` de novo.

Sem a chave, o botão continua lá, mas avisa que os GIFs ainda não foram ativados. A chave começa como *beta*, com limite de 100 buscas por hora, o que sobra para duas pessoas. Se um dia não bastar, peça a chave de produção no próprio painel do GIPHY.

A busca é feita direto pelo navegador, como o GIPHY pede, então a chave chega a quem está logado no chat (ela foi feita para isso). No banco fica só o endereço do GIF (coluna `media` em `potato_messages`), e o servidor só aceita endereços de imagem do próprio GIPHY.

## Figurinhas

O painel do **GIF** tem duas abas: **GIFs** (a busca do GIPHY) e **Figurinhas** (a sua coleção, que só você vê).

- **Salvar:** a estrela no canto de cada GIF da busca; ou, no menu de uma mensagem com GIF, foto ou figurinha (botão direito ou segurando no celular), o ícone de figurinha. Assim dá para guardar a figurinha que a outra pessoa mandou.
- **Criar:** em *Criar*, escolha uma imagem do aparelho. Ela é reduzida (lado maior até 512 px, guardando a transparência); GIF vai inteiro, até 3 MB.
- **Enviar:** um toque. Na conversa, a figurinha vai solta, sem balão, como no WhatsApp.
- **Organizar:** tira figurinhas da coleção (as já enviadas continuam aparecendo).
- Ficam na tabela `potato_items` (`kind = sticker`, até 300 por pessoa); as imagens, em `potato_files`, presas à figurinha. Salvar a figurinha de uma mensagem faz uma cópia, então apagar a mensagem não apaga a figurinha.

## Fotos e arquivos

O clipe, ao lado do botão GIF, abre duas opções: **Foto ou vídeo** (no celular, oferece também a câmera) e **Arquivo** (qualquer tipo). Também dá para arrastar arquivos para cima da conversa ou colar uma imagem (um print, por exemplo) no campo de mensagem. A mensagem aparece na hora, com uma barrinha mostrando o envio.

- **Fotos** abrem em tela cheia ao clicar, com botão para baixar. Foto grande é reduzida no navegador antes de subir (lado maior até 2048 px), então chega rápido. GIF vai inteiro.
- **Vídeos e áudios** tocam direto na conversa. **Outros arquivos** aparecem como um cartão com nome e tamanho; clicar baixa.
- **Onde ficam:** no próprio banco, na tabela `potato_files` (nada é gravado em pastas do servidor). Apagar a mensagem apaga o arquivo. Arquivo que subiu mas nunca virou mensagem (envio cancelado no meio) é apagado sozinho depois de um dia.
- **Tamanho máximo:** 10 MB por arquivo, ou menos se a hospedagem limitar. O site confere sozinho o `post_max_size` do PHP e o `max_allowed_packet` do MySQL e usa o menor; quem passar do limite vê o máximo no aviso. Para aceitar arquivos maiores, aumente esses dois valores no painel da hospedagem (até 10 MB).
- **Segurança:** o servidor descobre o tipo pelo conteúdo do arquivo, não pelo nome. Só imagem, vídeo e áudio de verdade abrem dentro do chat; o resto sempre baixa, para que uma página disfarçada nunca rode dentro do site. O endereço de cada arquivo usa uma chave aleatória e só chega a quem está logado.

## Mensagens de voz

Com o campo de mensagem vazio, o botão de enviar vira um **microfone**:

- **Um toque** começa a gravar sem precisar segurar, como no Instagram: a faixa colorida fica em cima (parar, a onda da voz e o tempo) e, embaixo, a lixeira e o enviar. O **quadradinho** para a gravação sem enviar: a faixa vira um tocador para ouvir antes (o mesmo botão toca e pausa, e a onda vai se pintando); depois, é só enviar ou apagar.
- **Segurando**, grava enquanto o dedo (ou o mouse) estiver no botão e envia ao soltar. Deslizar para a esquerda cancela; **arrastar para cima até o cadeado** trava a gravação, e aí dá para soltar o dedo e falar à vontade (depois é só tocar em enviar ou na lixeira).
- **Redução de ruído:** antes de gravar, o som do microfone passa por um corte dos graves (ronco abaixo de 80 Hz) e pelo [RNNoise](https://github.com/xiph/rnnoise), uma rede neural feita para separar a voz do barulho de fundo (ventilador, trânsito, TV), que roda no próprio aparelho (nada vai para fora). Num teste com fala e ruído de ventilador, o fundo caiu cerca de 37 dB e a voz ficou com o mesmo volume. Vem desligada; no **Perfil**, a chave *Redução de ruído* liga (vale só para o aparelho). Os arquivos ficam em `site/vendor/noise` ([web-noise-suppressor](https://github.com/sapphi-red/web-noise-suppressor), licença MIT, com o RNNoise da Xiph, licença BSD) e são baixados só na primeira gravação.
- **Qualidade:** o áudio vai como o microfone ouve, igual a um gravador de voz (64 kbps). Os filtros de chamada (cancelamento de eco e o filtro de ruído do navegador) ficam só para as chamadas: no celular, o cancelamento de eco grava no modo de telefonema, com a voz abafada.
- No computador, `Enter` com o microfone em foco começa a gravar e `Esc` cancela.
- Enquanto alguém grava, a outra pessoa vê **"gravando áudio…"** no lugar do "digitando".
- No balão, como no Discord: play, a forma de onda (tocar ou arrastar nela pula para aquele ponto) e o tempo à direita dela, sem botão de velocidade. Embaixo, na linha da hora, fica o *Transcrever*. Áudios seguidos da mesma pessoa tocam em sequência, e a música do bot abaixa enquanto um áudio toca (só para quem está ouvindo).
- **Transcrição:** com a chave configurada, cada áudio ganha o botão **Transcrever**. O texto aparece embaixo do player, para os dois, e fica guardado na mensagem (transcrever de novo não gasta nada). Para ativar:
  1. Crie uma chave grátis em [console.groq.com/keys](https://console.groq.com/keys) (o plano grátis dá para centenas de áudios por dia).
  2. Coloque a chave em `transcribe_key` no `config.php` e envie o `config.php` de novo.
  - Sem a chave, o botão nem aparece. O áudio só vai para o serviço quando alguém toca em **Transcrever**.
  - Não quer o texto na tela? **Ocultar texto**, na linha do tempo do áudio, esconde a transcrição só para você (fica guardado no aparelho); **Ver texto** mostra de novo.
  - Prefere a OpenAI? Use `transcribe_url` = `https://api.openai.com/v1/audio/transcriptions` e `transcribe_model` = `gpt-4o-mini-transcribe`, com a chave de lá.
- **Formato:** o navegador grava em MP4/AAC quando sabe (Chrome no computador, Safari), que toca em qualquer aparelho; senão, em WebM/Opus. Se um aparelho não conseguir tocar o formato (por exemplo, um iPhone antigo com um áudio WebM), o chat converte o áudio na hora e toca do mesmo jeito.
- O áudio sobe como os outros arquivos (mesma tabela `potato_files` e o mesmo limite de tamanho); a duração e a forma de onda ficam na mensagem. A gravação para sozinha em 15 minutos, ou antes, se chegar ao tamanho máximo, e é enviada.
- O microfone precisa de HTTPS e da permissão do navegador. No painel lateral da extensão o Chrome não libera o microfone: para gravar, abra o chat numa aba. Durante uma chamada a gravação fica desligada.

## Pesquisar e reler a conversa

A **lupa** no topo da conversa abre a pesquisa: no computador, numa coluna à direita (a conversa continua do lado); no celular, na tela toda.

- **O que ela acha:** o texto das mensagens e das legendas, o nome dos arquivos, o que foi dito nos áudios já transcritos e as músicas pedidas no `/play`. Não faz diferença maiúscula, minúscula nem acento ("joao" acha "João"). Procura na conversa inteira, não só no que já está carregado na tela, das mais novas para as mais antigas (30 de cada vez; descendo a lista, vêm mais).
- **Tocar num resultado** abre a conversa naquela mensagem, com o termo marcado em amarelo. Se ela for antiga, o chat abre só aquele trecho: dá para subir e descer à vontade (as mensagens vão chegando), e o **botão de descer** volta para o fim da conversa, contando as mensagens que chegaram enquanto você relia. Mandar uma mensagem também volta para o fim.
- **Ir para um dia:** embaixo do campo, escolha uma data e a conversa abre na primeira mensagem daquele dia.
- Tocar numa resposta antiga (o balãozinho citado) também abre o trecho dela, em vez de dizer que é antiga demais.

## Dados da mensagem

No menu de uma mensagem sua (botão direito, ou segurando no celular), o ícone **(i)** abre os *Dados da mensagem*: quando ela foi enviada e quando a outra pessoa leu ("hoje às 14:03"), ou se ainda não leu. Com a janela aberta, a leitura aparece na hora.

- A hora da leitura fica guardada em cada mensagem (coluna `read_at` em `potato_messages`). Responder também conta como ler o que veio antes.
- As mensagens lidas antes desta versão continuam lidas (os ✓✓ azuis), mas sem a hora: os dados mostram "Antes de o chat guardar a hora da leitura".

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
- Cada pedido aparece na conversa como um **cartão no estilo do Spotify**: capa, nome e artista, na cor da música (a que o próprio Spotify usa ou, no YouTube, a que mais aparece na capa). O cartão mostra ao vivo se a música está tocando (com a barra de tempo e o botão de pausar), pausada, **na fila** (botão **Tocar agora**) ou se **já tocou** (botão **Tocar de novo**).
- Enquanto toca, uma pílula com a capinha e as barrinhas dançando fica no **canto superior direito** da conversa. Ela abre o tocador: no computador, ao lado; no celular, na tela toda (arraste para baixo para fechar). Tem a capa grande (no YouTube dá para trocar pelo vídeo, no mesmo tamanho), o botão de **tela cheia** no canto da capa, a barra de tempo (dá para avançar), voltar ao começo, tocar/pausar, pular, parar, volume (só para você) e a fila (tocar agora ou tirar uma música dela).
- **Os dois ouvem a mesma parte ao mesmo tempo.** A fila fica no servidor (na tabela `potato_settings`, sem tabela nova), e cada aparelho acerta o tempo sozinho se ficar mais de 2 segundos fora. Pausar, pular ou avançar vale para os dois, com um aviso para a outra pessoa.
- **Fora do app:** no computador, a música continua com o chat em outra aba ou minimizado (a fila continua andando), e a notificação de mídia e as teclas de mídia mandam no tocador dos dois. **No celular, o YouTube só toca com o chat na tela:** quando o app sai da tela, o próprio player do YouTube para (tocar em segundo plano é recurso do YouTube Premium, e não há um jeito permitido de contornar isso num site). Por isso, enquanto a música toca, a tela do celular fica acesa com o chat aberto; e, ao voltar para o chat, a música volta sozinha, já no ponto em que está para os dois. Na extensão, fechar o painel lateral fecha o chat, e a música para junto.
- **Spotify:** o player do Spotify, sem login, só toca uma prévia de 30 segundos. Por isso, um link de **música** do Spotify toca a mesma música **inteira pelo YouTube** (o bot pega o nome e o artista no Spotify e acha a versão com a mesma duração), com a capa, a cor e o nome do Spotify. Com **álbum ou playlist**, todas as músicas vão para a fila (até 50) e cada uma toca inteira pelo YouTube quando chega a vez dela. Só os podcasts continuam no player do Spotify (sem login, prévias de 30 segundos, com o selo **Prévia**).
- **Som bloqueado:** se o navegador não deixar a música começar sozinha (acontece quando a pessoa ainda não tocou na página), o ícone ganha um pontinho vermelho. No computador e no Android, qualquer toque na página já libera o som. No iPhone, abra o tocador e toque no play do próprio player, que aparece no lugar da capa (o sistema exige o toque no player).
- Vídeos cujo dono proíbe tocar fora do YouTube são pulados com um aviso. Na busca pelo nome, eles já ficam de fora.
- **Busca pelo nome:** funciona sem configurar nada (o servidor lê a página de resultados do YouTube). Se um dia ela parar, configure a chave oficial: em [console.cloud.google.com](https://console.cloud.google.com), crie um projeto, ative a **YouTube Data API v3**, crie uma chave em *Credenciais* e coloque em `youtube_key` no `config.php`. A cota grátis dá cerca de 100 buscas por dia.
- O servidor precisa conseguir acessar a internet (YouTube e Spotify) pelo PHP, o que as hospedagens comuns permitem.

## Batata Watch Party (/watchparty)

Uma sala só para assistir junto: o vídeo grande, com cara de cinema, e a conversa do lado (no celular, embaixo). Abre pelo botão de TV no topo da conversa, pelo clipe de anexar → **Batata Watch Party** ou com `/watchparty`, sempre com uma abertura de cinema ao entrar e um encerramento ao sair (um toque na tela acelera; com "reduzir movimento" ligado no aparelho, a sala abre e fecha direto). Os dois veem o mesmo vídeo, no mesmo segundo: play, pause e avanço valem para os dois, e tem tela cheia.

Escolher é como no Rave: um catálogo com os serviços (no celular, os cartões passam para o lado). Tocou num, abre o catálogo dele; o que um escolher começa para os dois. Enquanto alguém escolhe, a outra pessoa vê "Ana está escolhendo na Netflix…".

| Serviço | Como escolhe |
| --- | --- |
| YouTube | O catálogo abre dentro da sala: prateleiras (Em alta, Músicas, Trailers, Humor, Games, Podcasts, Esportes, Documentários, Receitas) e a busca. Tocou no vídeo, começa para os dois. Colar um link na busca também vale, e `/watchparty nome do vídeo` continua funcionando |
| Netflix e HBO Max | Abre a Netflix ou a HBO Max de verdade (no celular, o app), na conta de cada um. Escolha lá e dê o play: com a extensão no computador, a sala começa sozinha para os dois. Veja abaixo |
| Twitch | O nome do canal (ao vivo; aí só dá para pausar, não avançar) ou o link de um vídeo gravado (`twitch.tv/videos/…`) |
| Do aparelho | Um escolhe o arquivo (MP4, WebM ou MOV, até 4 GB) e ele sobe para o servidor, com a porcentagem na tela; quando termina, começa para os dois, que assistem de lá. Quem mandou pode sair que o vídeo continua |

- **Tela:** o botão de quadradinhos na barra do vídeo alterna entre a conversa ao lado, o **modo cinema** (só o vídeo, a tela toda) e a **conversa flutuante** (transparente, por cima do vídeo, no canto). Vale só para o aparelho.
- **Vistos por vocês:** o que vocês já assistiram juntos fica numa fileira no começo do catálogo (e na tela de cada serviço). Um toque assiste de novo, para os dois.
- Quando um vídeo começa, a sala abre para os dois. Cada um sai quando quiser (o vídeo continua para o outro, e o botão de TV fica com um pontinho vermelho). O **X** embaixo do vídeo para para os dois.
- Começar um vídeo pausa a música do bot. Clipes da Twitch não têm como sincronizar.
- **Vídeo do aparelho no servidor:** ele sobe em pedaços de até 8 MB (ou menos, se o `post_max_size` da hospedagem for menor) e fica em disco, na pasta `filmes/` (criada sozinha ao lado do `index.php`, fechada para quem tentar abrir direto), não no banco. A internet caiu no meio: o envio continua de onde parou. O arquivo sai do servidor quando a sala troca de vídeo ou fecha o vídeo; um envio largado no meio sai em até um dia. Confira se a hospedagem tem espaço em disco para o tamanho dos filmes.

### Netflix e HBO Max

Os filmes da Netflix e da HBO Max são protegidos contra cópia: só tocam no site ou no app deles, com a conta de cada um, nunca dentro de outro site. Por isso, nesses dois, a sala funciona como um controle remoto dos dois players:

- **Mesma conta ou uma para cada:** cada um assiste na própria tela, logado na Netflix ou na HBO Max. Pode ser a mesma conta nos dois aparelhos (cada um no seu perfil; o plano precisa permitir 2 telas ao mesmo tempo) ou contas diferentes: o tempo é sincronizado pela sala, não pela conta. Se vocês moram em casas diferentes, a Netflix e a HBO Max podem pedir verificação ou cobrar à parte pelo uso fora de casa.
- **Transmitir a tela da Netflix numa chamada não funciona:** a proteção deles deixa o vídeo preto para quem assiste.
- **No computador, com a extensão do Chrome (versão 2.2.0):** toque na Netflix (ou na HBO Max) no catálogo da sala; ela abre numa aba. Escolha o filme ou o episódio e dê o play: a sala começa sozinha para os dois, com o nome do que está passando. A aba da Netflix da outra pessoa vai junto para o mesmo título (se não estiver aberta, o botão **Abrir na Netflix** da sala abre ele). Depois, o player de cada um segue a sala (play, pause e o mesmo segundo), e o play, o pause ou o avanço dado lá vale para os dois. No próximo episódio, a sala e a outra aba vão junto.
- **No app do computador** (veja [App do computador](#app-do-computador-windows)): igual à extensão, sem precisar dela. A Netflix e a HBO Max abrem numa janela do próprio app, com a conta de cada um, e seguem a sala do mesmo jeito.
- Assistindo sozinho, sem ter aberto pela sala, a extensão não mexe em nada.
- **No celular:** os apps da Netflix e da HBO Max não deixam nenhum outro app mandar no player nem dizer o que está passando. Escolha no app, volte para a sala e toque em **Começar a sessão**; depois, use a **Contagem 3, 2, 1**, que aparece nos dois aparelhos no mesmo instante, para darem o play juntos. Quando alguém pausa, o outro recebe o aviso para pausar também.
- A sala mostra o título, o relógio da sessão (igual para os dois) e o botão **Abrir na Netflix** / **Abrir na HBO Max**.
- **Nenhuma senha fica guardada:** salvar a senha da Netflix ou da HBO Max no banco não faria o filme tocar dentro do site e ainda deixaria as contas em risco.

## Contagem regressiva

Uma faixa no topo da conversa conta os dias, horas, minutos e segundos até o próximo encontro, igual para os dois (no horário de cada aparelho). Começa marcada para **12 de dezembro de 2026**, "Até a gente se ver". Tocar nela muda o texto, o dia e a hora (se quiser) ou desliga (desligada, liga de novo em Nós, no card Próximos); a mudança aparece na hora para a outra pessoa. No dia, vira "É hoje! 💛"; depois, some. Fica na tabela `potato_settings` (nome `countdown`) e some durante a chamada e a Watch Party.

## Nosso cantinho

Um lugar só de vocês dois, fora da conversa. No computador, cada parte é um item da barra lateral (embaixo da conversa); no celular e no painel da extensão, a barra lateral abre pelo **botão de menu** (☰) no canto de cima, que ganha um pontinho vermelho quando tem novidade lá dentro (cartinha nova, partida esperando a sua jogada…). Tudo muda ao vivo para os dois, e fica na tabela `potato_items` (as fotos ficam em `potato_files`, como as da conversa).

### Rotina do dia

O dia de cada um, lado a lado (no celular, um embaixo do outro). Cada pessoa preenche só o seu; o da outra aparece para ver. As setas do topo voltam aos dias anteriores.

- **Acordou:** a hora em que acordou.
- **Refeições:** café da manhã, almoço, lanche e jantar, cada uma com o que comeu e uma **foto do prato** (opcional). A hora em que contou aparece junto.
- **Rotina:** os hábitos de cada um (beber água, academia, estudar…). Monte a lista em *Montar*/*Editar* e toque em cada um quando fizer; o contador mostra quantos já foram, e completar tudo solta confete.
- **Humor**, **momentos do dia** (fotos com legenda, até 8) e **como foi o dia** (um texto livre).
- Quando a outra pessoa conta o que comeu, chega um aviso (e, no Android com o app fechado, uma notificação).

**Lembretes da rotina:** em *Lembretes da rotina*, escolha os horários (o padrão é acordar 9h30, café 10h30, almoço 13h30, jantar 20h30 e rotina 22h; o lanche começa desligado). Na hora, o app pergunta ("O que você almoçou hoje?"), mas só o que você ainda não contou; o da rotina diz quais hábitos faltam.

- **No Android, com o app fechado:** chega uma notificação com **Responder** — escreve ali mesmo ("arroz, feijão e bife") e a resposta vai direto para o seu dia, sem abrir o app. Na de acordar, dá para escrever a hora ("7:30", "7h", "6 e meia") ou tocar em *Acordei agora*; na da rotina, *Fiz tudo* marca todos os hábitos.
- **Com o site aberto** (e alguém mexendo nele), aparece um aviso no canto, com o campo para responder. Cada lembrete aparece num aparelho só.

### Agenda

A agenda dos dois, como um calendário de verdade:

- **Dia, Semana, Mês e Lista**, com *Hoje* e as setas para andar. Cada compromisso aparece na cor da agenda dele. No mês, cada dia mostra os compromissos (no celular, faixinhas coloridas com o começo do nome); na semana e no dia, a grade das 24 horas com a linha vermelha da hora atual; a lista mostra os próximos dois meses, dia por dia.
- Ao lado (no computador): **Criar**, o mini calendário, as **agendas** e os **próximos**. Cada agenda tem a sua cor, igual para os dois: a *dos dois* (rosa) e a de cada pessoa (azul e verde); desmarcar uma esconde os compromissos dela (só no seu aparelho). No celular, as agendas ficam numa fileira em cima do calendário.
- Tocar num compromisso abre os detalhes (dia, hora, onde, de quem, repetição, lembrete, anotação), com editar e apagar. Tocar num horário vazio da semana ou do dia já marca naquele horário; no mês, tocar num dia escolhe o dia, e tocar de novo marca nele.
- Cada compromisso tem ícone, título, dia, hora de começar e de terminar (ou o dia inteiro), lugar, de quem é, **repetição** (toda semana, todo mês — bom para o mesversário: no dia 31, cai no último dia dos meses mais curtos — ou todo ano) e **lembrete** (na hora, de 15 minutos a 1 dia antes). O lembrete chega como notificação no Android e como aviso no site aberto.
- Quando a outra pessoa marca um compromisso, chega um aviso; no menu, embaixo de *Agenda*, aparece o próximo.

### Sonhos e metas

Os sonhos dos dois, cada um com ícone, nome, anotação e, se quiser, **quanto juntar** (com a barra até o objetivo e o dinheiro que cada um guardou ou tirou), **até quando** e **passos** para marcar. *Realizamos!* comemora e leva o sonho para os *Realizados*.

### Cartinhas

O blog de cartinhas: escreva quando quiser, num papel de cor (creme, rosa, azul, lilás ou verde). Para a outra pessoa, a cartinha nova aparece com o selo **Nova!** (e o número no menu) até ser aberta; ao abrir, um envelope chega e abre, e a carta sobe. Quem escreveu vê quando foi lida e pode editar ou apagar. O rascunho (o título, o papel, a letra e o texto) fica guardado no aparelho até ser enviado.

- **Editor como um Word:** a barra em cima do papel tem letra e tamanho, negrito, itálico, sublinhado, riscado, cor da letra, marca-texto, alinhamento (esquerda, centro, direita, justificado), listas, título, tirar a formatação, desfazer e refazer. Colar traz só o texto; colar uma imagem a coloca solta no papel.
- **Imagens e figurinhas soltas no papel:** *Imagem* e *Figurinha* (da sua coleção) colocam a imagem num canto do papel. Arraste para onde quiser; a alça do canto muda o tamanho, a de cima gira, e a barrinha da imagem troca a moldura (polaroide, redonda, fita, sombra ou nenhuma), traz para a frente ou tira. As posições ficam em fração do papel, então a cartinha chega igual em qualquer tela. Até 16 por cartinha.
- **Papel:** 10 cores (creme, rosa, azul, lilás, verde, branco, amarelo, pêssego, kraft e noite) ou qualquer cor (a paleta na barra), com a tinta clara ou escura conforme o papel; fundo pautado, liso, quadriculado, de pontinhos, de corações ou de estrelas; e borda simples, dupla, pontilhada ou rosinha.
- **Segurança:** o servidor filtra o texto formatado (só as marcas e os estilos de formatação passam; script, eventos, links e imagens de fora somem). O texto puro sai dele para a prévia da lista.
- **Letra:** *Clássica*, *À mão*, *Cursiva*, *Bilhetinho*, *Máquina* (de escrever) ou *Moderna*. O campo do texto já mostra a letra e o papel escolhidos, e a cartinha chega igual para a outra pessoa. As letras vêm do Google Fonts (Caveat, Dancing Script, Patrick Hand e Special Elite), junto com a do site.
- **Fotos:** até 6 por cartinha. Elas sobem reduzidas, como as da conversa, e aparecem no fim da carta como polaroides; tocar abre grande.
- **Áudios:** até 3, logo embaixo do título (dá para ouvir enquanto lê), com o mesmo player das mensagens de voz. *Gravar* grava ali mesmo (com a redução de ruído, se estiver ligada no Perfil); *Escolher áudio* pega um arquivo do aparelho (MP3, M4A, OGG ou WAV, como uma música de vocês), e a forma de onda é medida no próprio aparelho. Dá para ouvir antes de enviar.
- Pode ir só com fotos ou só com áudio, sem texto. As fotos e os áudios ficam em `potato_files`, presos à cartinha: tirar um deles (ou apagar a cartinha) apaga o arquivo.

## Joguinhos

Em *Jogos* (no menu, ou no clipe da conversa → *Joguinhos*), cada jogo tem um cartão com a ilustração dele. Escolher um abre a **mesinha de jogo** na hora, e a outra pessoa recebe o convite na conversa (com a mesma ilustração e o botão *Jogar*). Em cima ficam o **placar** dos dois (as vitórias de cada um, as derrotas, os empates e quem está na frente, com a coroa, contando todas as partidas de tabuleiro que já acabaram, e embaixo jogo por jogo) e, só quando tem, as partidas **esperando você** (a sua vez, o seu voto ou a sua resposta). O servidor confere cada jogada e de quem é a vez.

| Jogo | Como funciona |
| --- | --- |
| Jogo da velha | Quem começa fica com o X. O tabuleiro é riscado à mão, cada X e O é traçado na hora e a linha da vitória risca as três casas. Embaixo, o placar da série entre vocês |
| Dama | Quem começa joga com as brancas; quem joga com as pretas vê o tabuleiro do lado dele. Pedra anda uma casa e come só para a frente; dama anda e come de longe, para todos os lados. Comer é obrigatório e continua enquanto der. Cada jogada chega animada para os dois: a pedra desliza até a casa nova e, comendo, pula por cima da outra, que é esmagada e sai do tabuleiro girando (com som de madeira). Dá para desistir |
| Jogo da memória | Oito pares de figuras. As cartas são distribuídas e viram em 3D; acertou, joga de novo; errou, as duas tremem e viram de volta. Quem achar mais pares ganha. As cartas fechadas nunca saem do servidor |
| Stop | Uma letra e seis categorias (nome, animal, comida, lugar, objeto e coisa fofa). Quem preencher tudo pede **STOP** e a rodada acaba para os dois; o outro só vê quantos campos você já preencheu. 10 pontos por palavra com a letra certa, 5 se os dois escreveram a mesma |
| Quem é mais provável? | Cada um vota em um dos dois. Os votos só aparecem quando os dois votarem |
| Verdade ou desafio | A outra pessoa escolhe verdade ou desafio e a carta vira, com uma pergunta ou um desafio fofinho; ela responde na conversa e pode desafiar de volta |
| Isso ou aquilo | Duas opções; cada um escolhe sem ver a escolha do outro. Será que combinam? |
| Perguntinha | Uma pergunta para os dois; as respostas aparecem quando os dois responderem |
| 4 em linha | Quem começa fica com as vermelhas. A peça cai na coluna (e quica); 4 seguidas em qualquer direção ganha, com a linha brilhando |
| Forca | Uma palavra com dica. Cada um chuta uma letra na sua vez: acertou, ganha um ponto por letra e joga de novo; errou, o boneco ganha uma parte e a vez passa. No computador, dá para digitar a letra. A palavra nunca sai do servidor antes do fim |

- **Modo +18 🔥:** a chave no topo dos jogos (pede confirmação; vale só para o aparelho) faz verdade ou desafio, quem é mais provável, isso ou aquilo e perguntinha virem do baralho apimentado, só para o casal. A partida fica marcada com 🔥 +18, e a revanche continua no +18.
- **Fim da partida:** uma faixa com troféu, empate ou derrota aparece em cima do tabuleiro, com confete para quem ganhou, e o *Revanche* começa outra igual.

As partidas que ainda estão rolando (até 20) vão junto com o histórico: mesmo que a partida tenha começado lá atrás na conversa, a mesinha continua aberta e recebendo as jogadas quando o chat recarrega (por exemplo, depois de o celular ficar um tempo bloqueado). E, se a conexão cair no meio de uma jogada, o tabuleiro volta a responder.

As cartas de verdade ou desafio, quem é mais provável, isso ou aquilo, perguntinha (e as +18, com 18 no fim do nome) e as palavras da forca estão em `site/lib/jogos.php` (dá para acrescentar à vontade) e não se repetem até o baralho acabar. As ilustrações dos jogos ficam em `site/img/jogos`.

## Chamadas e transmissão de tela

O botão de telefone no topo da conversa abre o menu: chamada de voz, de vídeo ou já transmitindo a tela; durante a chamada, a barra de baixo liga e desliga microfone, câmera e transmissão.

- **Ligar com a outra pessoa offline:** a sala fica guardada no servidor e toca por 1 minuto. Sem a outra pessoa entrar, encerra após 5 minutos de espera. Quando alguém sai de uma chamada em andamento, a sala fica disponível por mais 5 minutos, mesmo com a outra pessoa esperando. Se os dois saírem, a segunda saída não estende esse prazo. Uma entrada ou reentrada real renova a espera; com os dois presentes, a contagem é cancelada.
- **Voltar à chamada:** ao recarregar ou entrar novamente na conta, quem já participava volta automaticamente à mesma sala, preservando o microfone silenciado. Também há o botão **Entrar novamente**, com a contagem do tempo restante. Uma chamada nova exige atendimento; outra aba não toma uma chamada ativa automaticamente. O compartilhamento de tela precisa ser iniciado novamente, com a autorização exigida pelo navegador/Android.
- **Na conversa,** cada chamada vira uma linha, como no Discord: "André iniciou uma chamada que durou 9 minutos.", "Você perdeu uma chamada de André que durou poucos segundos.", "Duda recusou a sua chamada." No celular vai a versão curta, que cabe numa linha com a hora ("André iniciou uma chamada · 9 min", "Chamada perdida de André"). Enquanto a chamada espera você, a linha tem o botão Entrar. Essas linhas (e os cartões de música e de jogo) não se apagam.
- **Conversas separadas:** o banco já guarda cada conversa à parte (tabelas `rooms`, `reads` e `invites`, versão 9, migrada sozinha no primeiro acesso: tudo o que havia vira a conversa do casal). O convite para adicionar outra pessoa existe no servidor, mas o botão está escondido: o chat continua só de vocês dois.

- **Layout:** o botão de quadradinhos na barra da chamada alterna entre *Grade*, *Foco* (a outra pessoa grande e você numa janelinha no canto), *Lado a lado* (com transmissão, as câmeras numa coluna ao lado da tela, sem cobrir nada) e *Só a outra pessoa*. Vale só para o aparelho.
- **Transmitir a tela:** antes de começar, uma janela pergunta a qualidade (*Leve* 720p, *Nítida* 1080p, *Fluida* 1080p a 60 fps, *Ultra* 1440p e *Ultra fluida* 1440p a 60 fps; as duas últimas pedem internet boa e, no app do Android, a captura vai até 1080p) e se o som do que estiver tocando vai junto. Depois o navegador pergunta qual tela, janela ou aba mostrar. Quem transmite vê a própria tela só como uma prévia pequena no canto, com o botão *Parar*; quem assiste vê a transmissão grande, com volume, tela cheia e **janelinha flutuante** (para continuar assistindo enquanto usa outras coisas).
- **No celular dá para assistir, mas não para transmitir:** os navegadores de celular (Chrome no Android, Safari no iPhone) não deixam nenhum site capturar a tela. O botão continua lá e explica isso; para transmitir, use o Chrome, o Edge ou o Firefox no computador.
- **Enquadramento:** cada câmera aparece no formato dela (celular em pé fica em pé), sem cortar o rosto.

**Requisitos:** PHP 7.4 ou superior com a extensão `pdo_mysql` (vem ativa em praticamente todas as hospedagens), e MySQL 5.6+ ou MariaDB 10.1+.

## App do computador (Windows)

A pasta `desktop/`, na raiz do repositório, tem o Potato Chat como programa do Windows. A janela abre o próprio site (`https://potato.andrejrs.com.br/`), então é tudo igual e cada atualização do site já vale no app, sem reinstalar. O que o app acrescenta:

- **Transmitir a tela com som**, com um seletor de telas e janelas (com miniatura). O som que vai junto é o do computador inteiro: se a outra pessoa ouvir eco da própria voz durante a chamada, transmita sem o som.
- **Netflix e HBO Max dentro do app, como no Rave:** na Batata Watch Party, tocar na Netflix ou na HBO Max abre uma janela do app com o serviço (o login é feito uma vez e fica guardado neste computador; nenhuma senha passa pelo Potato). O player segue a sala do mesmo jeito que a extensão e o app do Android. Por baixo, é a mesma ponte do Android (`android/app/src/main/assets/stream-sync.js`).
- Abrir o app de novo só traz a janela que já está aberta para a frente; links de fora abrem no navegador.

**Testar e gerar o instalador** (Node 22+):

```
cd desktop
npm install
npm test        # abre o site de verdade e confere a transmissão, a ponte da Watch Party e o Widevine
npm start       # abre o app
npm run dist    # gera o instalador em desktop/dist/
```

**Assinatura para a Netflix e a HBO Max (uma vez por computador):** elas só tocam num app com a assinatura VMP do Widevine. O app usa o Electron da castLabs, que tem o Widevine, e a assinatura é feita de graça pela conta EVS da castLabs:

```
python -m pip install --upgrade castlabs-evs
python -m castlabs_evs.account signup     # cria a conta (pede e-mail e senha)
npm run sign-dev                          # só para testar com npm start
```

O `npm run dist` assina o app sozinho depois de montar (e falha com aviso se a conta não existir). Sem a assinatura, o resto do app funciona, mas a Netflix e a HBO Max podem recusar o vídeo; nesse caso, a extensão do Chrome continua valendo.

## Extensão do Chrome

1. Em `chrome://extensions`, ative o **Modo do desenvolvedor** e clique em **Carregar sem compactação**. Escolha a pasta `extensao/`. Se a versão antiga estiver instalada, remova-a antes.
2. Nas opções da extensão, coloque o endereço do site (ex.: `https://chat.seudominio.com.br`) e clique em **Testar conexão**.
3. **Atualizou os arquivos da pasta `extensao/`?** Em `chrome://extensions`, clique no botão de recarregar da extensão e recarregue as abas da Netflix e da HBO Max que estiverem abertas. A versão 2.2.0 é a que começa a Batata Watch Party sozinha quando vocês escolhem na Netflix ou na HBO Max.

Os atalhos continuam iguais: botão direito → *Enviar para o nosso chat*, `pc` + Espaço na barra de endereço, e `Alt+Shift+O`.

## Configurações (`config.php`)

| Chave | Para que serve |
| --- | --- |
| `db` | Host, porta, nome, usuário, senha e prefixo das tabelas do MySQL |
| `token_secret` | Chave das sessões. Vazio = gerada uma vez e guardada no banco |
| `poll_wait` | Segundos que cada consulta espera por novidades (padrão 20). Use `0` se a hospedagem derrubar requisições demoradas: o chat passa a consultar a cada 1,5 s |
| `giphy_key` | Chave do GIPHY para a busca de GIFs. Vazio = GIFs desligados |
| `youtube_key` | Opcional: chave da YouTube Data API para o `/play` buscar pelo nome do jeito oficial. Vazio = busca pela página de resultados do YouTube |
| `transcribe_key` | Opcional: chave do serviço de transcrição dos áudios (Groq, grátis). Vazio = sem o botão Transcrever |
| `transcribe_url`, `transcribe_model` | Opcionais: endereço e modelo da transcrição. O padrão é o Groq (`whisper-large-v3-turbo`); qualquer serviço no formato da OpenAI serve |

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

Teste automático (Node 20+ e PHP no PATH): `npm test`. Ele também cobre a pesquisa, os trechos antigos, a hora da leitura, o Nosso cantinho (o dia, os hábitos, as respostas aos lembretes, a agenda com repetições, os sonhos e as cartinhas com fotos, áudios e letra) e as regras dos joguinhos. Por padrão ele usa o MySQL em `127.0.0.1:3399`, banco `potato_teste`, usuário `potato`, senha `senha-teste`. Para usar outro, defina `POTATO_TEST_DB_HOST`, `_PORT`, `_NAME`, `_USER` e `_PASS`. Ele cria tabelas com um prefixo próprio e as apaga no fim.

## Limites

- Uma sala, só duas pessoas. Cada pessoa pode ter várias abas, aparelhos e a extensão conectados.
- Cada aba aberta mantém uma requisição PHP esperando por até `poll_wait` segundos. Para duas pessoas isso é pouco, mas planos muito limitados podem pedir um `poll_wait` menor.
- As chamadas usam WebRTC com servidores STUN públicos. Redes muito restritas podem precisar de um servidor TURN.
- Fotos e arquivos: até 10 MB cada (ou o limite da hospedagem, se for menor). Ficam no banco, então ocupam o espaço do MySQL do plano.
