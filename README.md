# Potato Chat

Nosso chat privado, só para nós dois, com histórico persistente, senha de entrada, chamadas de áudio/vídeo, compartilhamento de tela e extensão para o painel lateral do Chrome.

## Executar localmente

1. Instale o Node.js 20 ou superior.
2. Copie `.env.example` para `.env` e altere a senha e o segredo.
3. Instale as dependências com `npm install`.
4. Inicie com as variáveis do `.env` carregadas pelo seu serviço de hospedagem, ou no PowerShell:

```powershell
$env:CHAT_PASSWORD="sua-senha-forte"
$env:TOKEN_SECRET="uma-chave-longa-e-aleatoria"
npm start
```

Abra `http://localhost:3000` em dois navegadores ou dispositivos.

## Instalar a extensão no Chrome

1. Acesse `chrome://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta `extension`.
4. Clique no ícone da extensão para abrir o chat no painel lateral.
5. Depois de publicar o site, abra as opções da extensão e troque `http://localhost:3000` pela URL pública.

### Enviar mensagens pela extensão

Depois de entrar na conversa pelo painel lateral (uma vez por sessão do navegador):

- **Botão direito** em texto selecionado, link, imagem ou página → *Enviar para o nosso chat*.
- **Barra de endereço:** digite `pc`, `Espaço`, a mensagem e `Enter`.
- **Atalho:** `Alt+Shift+O` abre o painel; apertando de novo, ele some na hora. Com o painel em foco, `Esc` (ou o botão do olho riscado) também esconde.
- Com o painel fechado, mensagens novas aparecem como notificação e contador no ícone.

Se você ainda não entrou, o que for enviado fica na fila e sai assim que você entrar.

## Recursos do chat

- **Fica logado:** depois de entrar, recarregar a página, fechar a aba ou o navegador não pede a senha de novo (sessão de 1 ano, renovada sozinha). Só o botão **Sair** desloga.
- **Só duas pessoas:** defina `CHAT_USERS=Nome1,Nome2` no `.env`, ou deixe vazio e os dois primeiros nomes que entrarem ficam registrados em `data/messages.users.json`. Para trocar, apague esse arquivo.
- **Visto por último:** "online" só conta quando o chat está aberto (site ou painel); ao fechar, aparece "Visto por último hoje às 14:03".

- Confirmação de envio (relógio → ✓ entregue → ✓✓ azul lida), reenvio automático após queda de conexão, sem duplicar.
- Responder, reagir (passe o mouse ou toque na mensagem; duplo clique = ❤️) e apagar para todos.
- "Digitando…", online / visto por último, separadores de dia, links clicáveis, emojis grandes.
- Animações com GSAP e sons sintetizados (botão de som para silenciar). Efeitos por palavra: "te amo", "parabéns", "boa noite", "kkkk", "batata".
- Chamadas no estilo Discord: começa por voz, vídeo ou tela e, durante a chamada, qualquer um liga/desliga microfone, câmera e **transmissão de tela** sem religar.
  - Transmissão em tela grande com selo **AO VIVO**, tela cheia (duplo clique), volume do som da transmissão e qualidade 720p, 1080p ou 1080p 60 fps.
  - Durante a chamada o topo some; no computador a chamada fica grande à esquerda e o chat numa coluna à direita (o botão de balão esconde/mostra o chat).
  - Com transmissão, as pessoas viram bolinhas no canto (anel verde quando falam, ícone de mudo, borda vermelha em quem transmite); câmera ligada vira uma janelinha.
- Ícones em SVG (Lucide, licença ISC; o de desligar é do Material Icons, Apache 2.0), definidos uma vez no `index.html`.

## Publicação

O servidor precisa de uma hospedagem Node.js com conexão WebSocket persistente (por exemplo, Render, Railway, Fly.io ou VPS). Configure `CHAT_PASSWORD`, `TOKEN_SECRET` e `PORT`. Para câmera, microfone e compartilhamento de tela fora do localhost, o endereço público precisa usar HTTPS.

As mensagens ficam em `data/messages.json` e as leituras/último acesso em `data/messages.state.json`. Em produção com múltiplas instâncias, substitua esse arquivo por um banco de dados compartilhado.

## Limites desta primeira versão

- Uma única sala, limitada a duas pessoas (cada pessoa pode ter várias abas/dispositivos e a extensão conectados).
- O histórico guarda as 500 mensagens mais recentes.
- WebRTC usa servidores STUN públicos; redes corporativas ou muito restritas podem exigir um servidor TURN.
- Mensagens são protegidas pelo acesso ao servidor, mas não têm criptografia ponta a ponta própria.
