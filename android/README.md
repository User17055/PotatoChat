# Potato Chat para Android

O app abre o site do Potato Chat (a versão PHP publicada em `https://potato.andrejrs.com.br/`) num WebView e completa o que um site sozinho não faz no celular:

- **Notificações de verdade**, também com o app fechado: um serviço em segundo plano fica conectado ao chat e mostra cada mensagem no estilo de conversa do Android, com a **foto de quem mandou**, as últimas mensagens de antes como contexto e o **Responder** direto da barra. Fotos, áudios e GIFs aparecem como "Foto", "Mensagem de voz (0:12)", "GIF"…
- **Nosso cantinho** (com o app fechado): os **lembretes da rotina** chegam como notificação com **Responder** — "O que você almoçou?" se responde ali mesmo, e a resposta vai direto para o dia da pessoa. Na de acordar, dá para escrever a hora ou tocar em *Acordei agora*; na da rotina, *Fiz tudo*. Também chegam os lembretes dos compromissos da agenda e as novidades da outra pessoa (cartinha nova, compromisso marcado, sonho realizado, o que comeu). Tocar abre o app direto naquela parte. Os canais *Lembretes* e *Nosso cantinho* podem ser ajustados nas configurações de notificação do Android.
- **Chamadas com o app fechado:** a chamada recebida toca com o toque do celular, também bloqueado (em tela cheia), com *Atender* e *Recusar*; recusar não abre o app. Depois de 1 minuto ela vira "está te esperando na chamada", com *Entrar*. Chamada perdida chega com *Ligar de volta*.
- **Chamada em segundo plano:** saindo do app (ou desligando a tela) no meio de uma chamada, ela continua, com a notificação de chamada (tempo, *Silenciar* e desligar). A câmera desliga ao sair e volta sozinha ao voltar para o app (o Android não deixa a câmera em segundo plano).
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
