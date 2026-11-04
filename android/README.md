# Potato Chat para Android

O app abre o site do Potato Chat (a versão PHP publicada em `https://potato.andrejrs.com.br/`) num WebView e completa o que um site sozinho não faz no celular:

- **Notificações de verdade**, também com o app fechado: um serviço em segundo plano fica conectado ao chat e mostra cada mensagem no estilo de conversa do Android, com a **foto de quem mandou**, as últimas mensagens de antes como contexto e o **Responder** direto da barra. Fotos, áudios e GIFs aparecem como "Foto", "Mensagem de voz (0:12)", "GIF"…
- **Nosso cantinho** (com o app fechado): os **lembretes da rotina** chegam como notificação com **Responder** — "O que você almoçou?" se responde ali mesmo, e a resposta vai direto para o dia da pessoa. Na de acordar, dá para escrever a hora ou tocar em *Acordei agora*; na da rotina, *Fiz tudo*. Também chegam os lembretes dos compromissos da agenda e as novidades da outra pessoa (cartinha nova, compromisso marcado, sonho realizado, o que comeu). Tocar abre o app direto naquela parte. Os canais *Lembretes* e *Nosso cantinho* podem ser ajustados nas configurações de notificação do Android.
- **Chamadas com o app fechado:** a chamada recebida toca com o toque do celular, também bloqueado (em tela cheia), com *Atender* e *Recusar*; recusar não abre o app. Depois de 1 minuto ela vira "está te esperando na chamada", com *Entrar*. Chamada perdida chega com *Ligar de volta*.
- **Chamada em segundo plano:** saindo do app (ou desligando a tela) no meio de uma chamada, ela continua, com a notificação de chamada (tempo, *Silenciar* e desligar). A câmera desliga ao sair e volta sozinha ao voltar para o app (o Android não deixa a câmera em segundo plano).
- **Chamada durante a navegação:** o botão *Recolher* libera a conversa e o menu. Uma faixa no topo mostra com quem você está em chamada, o tempo, o microfone e o botão de sair; ela acompanha o perfil, o Nosso Cantinho e outras conversas. Tocar na faixa abre a chamada original, preservando o mudo. Sem vídeo, o painel no celular fica compacto. Essa interface vem do site e não exige outro APK.
- **Transmitir a tela do celular:** captura nativa com MediaProjection, após a autorização do Android, com resolução de até 1080 pixels no lado menor, proporção e rotação preservadas. A conexão local usa até 16 Mbps para preservar texto antes de a chamada aplicar a qualidade escolhida para a internet. A própria transmissão não aparece no app, evitando espelho infinito.
- **Som interno (Android 10+):** a opção de compartilhar áudio envia o playback de outros apps em uma faixa separada da voz. Usa AudioPlaybackCapture na mesma projeção de tela e PCM 48 kHz estéreo no ADM do WebRTC, sem abrir outro microfone. Apps podem bloquear a captura; conteúdo protegido e áudio de comunicação não são capturáveis. O áudio do próprio Potato Chat é excluído para não devolver ao interlocutor o que ele enviou. Se a captura de som falhar, a tela continua e o site avisa. No Android 8/9 a opção fica desabilitada.
- **Miniatura flutuante:** Home ou Voltar abrem o Picture-in-Picture quando há vídeo recebido. O botão de miniatura também abre durante a chamada. A janela mostra exclusivamente a tela recebida ou a câmera da outra pessoa, com proporção ajustada, sem chat, botões do site ou prévia própria. Sem vídeo remoto a chamada continua pelo áudio, sem abrir uma janela vazia. O Android oferece sua ação de desligar ao tocar na miniatura.
- **Sempre conectado:** a conexão em segundo plano volta sozinha depois de ligar o celular, e não tem mais o limite de 6 horas por dia do Android 15. No Samsung, se as chamadas não tocarem com o app fechado, tire o Potato Chat dos "apps em suspensão" (Configurações → Bateria).
- **Permissões** de microfone e câmera (chamadas e mensagens de voz), de notificações e de arquivos (anexar e baixar).
- **Teclado**: com ele aberto, o site encolhe até em cima dele, então o campo de mensagem fica sempre à vista; as abas de baixo saem só enquanto ele está aberto.
- Ícone próprio (a batata do site), também no tema monocromático do Android 13+.

Tudo o que é do chat (mensagens, chamadas, música, Watch Party, perfil) vem do site: quando o site é atualizado, o app já mostra a novidade, sem instalar de novo.

## Gerar

Abra esta pasta no Android Studio ou execute:

```powershell
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
./gradlew.bat assembleDebug
```

O APK sai em `app/build/outputs/apk/debug/app-debug.apk`. Ele inclui só a ABI `arm64-v8a`, a dos aparelhos Android atuais.

## Testar com o site no computador

O endereço do site vem da propriedade `potatoSite` (o padrão é o site publicado). Com o PHP local (`php -S 127.0.0.1:8000 -t ../versao-php/site`) e o emulador:

```powershell
./gradlew.bat assembleDebug -PpotatoSite=http://localhost:8000/
adb reverse tcp:8000 tcp:8000
```

Em `localhost` o microfone e a câmera funcionam (o Android trata como endereço seguro). No APK de debug, o WebView aceita a depuração do Chrome (`chrome://inspect`).

## Produção

Para distribuir, crie uma chave de assinatura e configure um build `release`.

O APK **1.4.0** adiciona uma sessão de mídia nativa para a música: notificação e tela bloqueada com capa, título, artista, progresso, reproduzir/pausar, voltar ao início, próxima, silenciar e parar. A disposição dos controles depende da versão do Android; os controles adicionais aparecem ao expandir o player. Pausar, avançar, mudar a posição e parar usam a fila compartilhada; silenciar muda só o volume deste aparelho. Home e Voltar preservam o WebView enquanto houver uma faixa aberta. A notificação permanece ao voltar ao aplicativo e encerra ao parar a música, sair da conta ou destruir a Activity.

O APK **1.4.1** usa a batata como ícone da notificação e prepara duas versões da arte: a capa nítida para a miniatura e uma cópia desfocada com sombreado para o fundo. No Android 13+, `ART` fornece o fundo ao player do sistema; `ALBUM_ART`, `DISPLAY_ICON` e o ícone grande mantêm a capa original. Nas versões anteriores, os corpos compacto e expandido usam o fundo desfocado, mantendo os controles de mídia do Android. O sistema e o fabricante ainda determinam o enquadramento final do cartão. A arte é processada e armazenada em cache fora da thread da interface e é removida quando a próxima faixa não possui capa.

A chamada tem sua própria notificação, com silenciar/ativar microfone e desligar. Cada ação identifica a chamada ou faixa que a originou; ações antigas não controlam outra sessão. O contador de ausência e o PiP das versões anteriores continuam disponíveis. Os arquivos de `versao-php/site/`, inclusive `native-music.js`, são publicados pelo fluxo Git → GitHub Actions → FTP. As configurações privadas de TURN e música ficam ao lado de `config.php` e não entram no Git. Veja [TURN](../ops/TURN.md) e [música](../ops/MUSIC.md).

O APK **1.4.2** corrige a leitura da capa baixada: `BitmapFactory.Options.inSampleSize` precisa começar em 1, pois o valor padrão 0 causava divisão por zero antes de decodificar o JPEG. O erro era capturado e o player recebia apenas o fundo sem arte. Falhas temporárias agora são registradas no Logcat (`PotatoMusic`) e recebem até três tentativas, com intervalo. O teste de regressão baixa um JPEG por HTTP, decodifica, prepara o fundo e verifica o cache; para conferir uma imagem real adicionalmente, defina `POTATO_TEST_COVER_URL` antes de executar `testMediaNotifications`.

O APK **1.4.3** reduz o desfoque e o sombreado do banner de fundo e mantém imagens em resolução maior para preservar os detalhes da capa.

`./gradlew.bat testMediaNotifications` executa os testes Robolectric/JUnit de arte, metadados, estado e ações da música e da chamada. Verifica o desfoque, a preservação da capa original, a remoção da arte anterior e a renderização do corpo expandido em Android 12L. O runner usa os mesmos recursos e classpath dos testes Android e evita o [problema de codificação do Test worker do Gradle 8 em caminhos acentuados no Windows](https://github.com/gradle/gradle/issues/30304). `npm run test:native-music` valida a ponte e `npm run test:native-music-browser` valida os controles no site com PHP/MySQL e áudio real. A ponte Android é simulada no teste de navegador; tela bloqueada e disposição final do player ainda precisam de validação em aparelho Android.

`npm run test:rtc` verifica a negociação e o encerramento das duas faixas. Com o PHP/MySQL de teste e Playwright configurados, `POTATO_TEST_SCREEN=1 npm run test:call-rejoin` valida o percurso completo no navegador com um produtor Android simulado: vídeo em pé, áudio recebido no PC, rotação, ausência de prévia própria e PiP sem interface. A captura real de playback e a janela nativa ainda precisam ser verificadas em um aparelho Android; a simulação não substitui esse teste.

Para testar em emulador x86: `./gradlew.bat assembleDebug -PpotatoAbis=x86_64 -PpotatoSite=http://localhost:8311/`. A fixture `node ../tests/android-smoke.mjs` permite validar captura, encerramento, microfone e PiP sem usar contas reais (`adb reverse tcp:8311 tcp:8311`).

Home e Voltar preservam a Activity da chamada. Forçar parada do app, encerrar seu processo ou destruir a Activity interrompe a mídia. Se outra pessoa permanecer na sala, ela fica disponível por até cinco minutos para reentrar; quando a última pessoa sai, a chamada encerra imediatamente. Uma recarga ou perda de conexão só retoma automaticamente a chamada que estava ativa neste navegador. Tocar em **Sair da chamada** ou sair da conta cancela a retomada automática, inclusive após relogar; para voltar, é preciso tocar em **Voltar**. O aviso de ausência mostra o tempo restante e uma barra de progresso. A captura da tela precisa de nova autorização. O Android também pode interromper a captura ao bloquear a tela, mantendo a voz enquanto o processo continuar ativo. PiP depende de suporte e permissão nas configurações do Android.
