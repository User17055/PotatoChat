# Potato Chat Android nativo

Cliente Android escrito em Kotlin e Jetpack Compose. Ele não incorpora o site e não usa WebView: comunica-se diretamente com `/api/login`, Socket.IO e o protocolo WebRTC do servidor Potato Chat.

## Recursos

- Login e sessão persistente, mesma sala e mesmo histórico do site.
- Mensagens em tempo real, respostas, reações, apagar para todos, paginação, confirmação de envio/leitura, presença e "digitando".
- Interface Compose inspirada no visual original, com a batata desenhada nativamente e efeitos por palavras.
- Chamadas WebRTC nativas de voz e vídeo interoperáveis com o site.
- Transmissão nativa da tela do Android com `MediaProjection` e serviço em primeiro plano.
- Notificações Android de mensagens e chamadas em segundo plano, com histórico recente da conversa e resposta direta pela barra de notificações.
- Permissões nativas de microfone, câmera, notificações e captura de tela.

## Gerar

Abra esta pasta no Android Studio ou execute:

```powershell
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
./gradlew.bat assembleDebug
```

O APK sai em `app/build/outputs/apk/debug/app-debug.apk`. O artefato entregue na raiz desta pasta chama-se `PotatoChat-native-debug.apk`.

Na primeira abertura, informe a URL HTTPS do servidor. No emulador, `http://10.0.2.2:3000` acessa o servidor Node local. O APK atual inclui a ABI `arm64-v8a`, usada pelos aparelhos Android atuais.

## Produção

Para distribuir, crie uma chave de assinatura e configure um build `release`. Em redes restritas, adicione um servidor TURN ao `WebRtcCallManager`; o servidor original também usa apenas STUN e tem a mesma limitação.
