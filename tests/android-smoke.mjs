// Fixture local para validar captura real, serviço e PiP no emulador/aparelho.
// Build: gradlew assembleDebug -PpotatoSite=http://localhost:8311/ -PpotatoAbis=x86_64
// Conexão: adb reverse tcp:8311 tcp:8311
import http from "node:http";
import fs from "node:fs/promises";

const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Captura Android</title><link rel="stylesheet" href="/android-call.css">
<style>body{background:#12100d;color:white;font:22px sans-serif;padding:24px}button{font:22px sans-serif;padding:20px;margin:8px}video{width:100%}.pip video{display:none}</style>
<h1>Teste de transmissão</h1><button id="start">Iniciar</button><button id="stop">Encerrar</button><p id="state">Pronto</p><video autoplay muted playsinline></video>
<script type="module">
import {startNativeScreen,stopNativeScreen} from '/native-screen.js';
import {updateRemotePip} from '/remote-pip.js';
let screen=null,mic=null,pip=false;
const video=document.querySelector('video'),state=document.querySelector('#state');
const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');
setInterval(()=>{ctx.fillStyle='#245c8e';ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.font='32px sans-serif';ctx.fillText('Vídeo remoto simulado',30,100);ctx.fillText(new Date().toLocaleTimeString(),30,180)},100);
const received=canvas.captureStream(10).getVideoTracks()[0];
const send=()=>window.PotatoAndroid.postMessage(JSON.stringify({type:'call',active:!!mic,id:'smoke-test',name:'Teste local',media:'screen',connected:true,since:Date.now(),mic:true,screen:!!screen,peerVideo:!!screen}));
window.potatoCall=(action,value)=>{if(action==='pip'){pip=value;document.documentElement.classList.toggle('android-pip',value)}if(action==='hangup')document.querySelector('#stop').click()};
document.querySelector('#start').onclick=async()=>{try{mic=await navigator.mediaDevices.getUserMedia({audio:true});send();screen=await startNativeScreen({height:1080,frameRate:30},true);video.srcObject=screen;await video.play();updateRemotePip(received);state.textContent='Transmitindo';send()}catch(e){state.textContent=e.message;fetch('/report',{method:'POST',body:JSON.stringify({error:e.message})})}};
document.querySelector('#stop').onclick=()=>{stopNativeScreen();screen=null;mic?.getTracks().forEach(t=>t.stop());mic=null;video.srcObject=null;state.textContent='Encerrado';send()};
setInterval(()=>fetch('/report',{method:'POST',body:JSON.stringify({screen:!!screen,audioTracks:screen?.getAudioTracks().length||0,mic:!!mic,pip,hidden:document.hidden,frames:video.getVideoPlaybackQuality().totalVideoFrames,width:video.videoWidth,height:video.videoHeight,state:state.textContent})}),1500);
</script>`;
const server = http.createServer(async (req, res) => {
  if (req.url === "/report") {
    let body = ""; for await (const chunk of req) body += chunk;
    console.log(body); res.end("ok");
  } else if (req.url === "/shutdown") { res.end("ok"); server.close(); }
  else if (req.url === "/native-screen.js") { res.setHeader("Content-Type", "text/javascript"); res.end(await fs.readFile(new URL("../public/native-screen.js", import.meta.url))); }
  else if (req.url === "/remote-pip.js") { res.setHeader("Content-Type", "text/javascript"); res.end(await fs.readFile(new URL("../public/remote-pip.js", import.meta.url))); }
  else if (req.url === "/android-call.css") { res.setHeader("Content-Type", "text/css"); res.end(await fs.readFile(new URL("../public/android-call.css", import.meta.url))); }
  else { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html); }
});
server.listen(8311, "127.0.0.1", () => console.log("Fixture Android pronta em localhost:8311"));
