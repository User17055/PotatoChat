<?php
// Página do Potato Chat: o mesmo HTML da versão Node, servido pelo PHP.
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Permissions-Policy: camera=(self), microphone=(self), display-capture=(self)');
// Só o próprio site e a extensão do Chrome podem incorporar o chat.
header("Content-Security-Policy: frame-ancestors 'self' chrome-extension:");

// Versão no endereço dos arquivos: depois de atualizar o site, ninguém fica com CSS/JS antigo.
function asset(string $file): string
{
    return $file . '?v=' . (@filemtime(__DIR__ . '/' . $file) ?: 1);
}
?>
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#12100d" />
    <title>Potato Chat</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 142 100'%3E%3Cdefs%3E%3CradialGradient id='g' cx='40%25' cy='30%25' r='78%25'%3E%3Cstop offset='0' stop-color='%23f4d496'/%3E%3Cstop offset='.4' stop-color='%23dcaa62'/%3E%3Cstop offset='.75' stop-color='%23b47c38'/%3E%3Cstop offset='1' stop-color='%236f4419'/%3E%3C/radialGradient%3E%3C/defs%3E%3Cpath fill='url%28%23g%29' d='M11 57C5 40 19 24 41 19c14-3 24 1 38-2 25-5 50 6 54 26 3 18-9 31-27 37-18 6-38 7-58 5-24-2-31-11-37-28Z'/%3E%3Cg fill='%235a3410'%3E%3Cellipse cx='46' cy='38' rx='4' ry='2.6'/%3E%3Cellipse cx='92' cy='27' rx='3.4' ry='2.2'/%3E%3Cellipse cx='106' cy='60' rx='3.8' ry='2.4'/%3E%3Cellipse cx='65' cy='72' rx='4.2' ry='2.7'/%3E%3C/g%3E%3C/svg%3E" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap" />
    <link rel="stylesheet" href="<?= asset('styles.css') ?>" />
    <script>
      // Já logado: vai direto para o chat, sem piscar a tela de login.
      try { if (JSON.parse(localStorage.getItem("potato.session"))?.token) document.documentElement.classList.add("has-session"); } catch {}
      // Tema escolhido: aplicado antes de desenhar a página, sem piscar o tema padrão.
      try { const theme = JSON.parse(localStorage.getItem("potato.theme")); if (/^[a-z]+$/.test(theme)) document.documentElement.dataset.theme = theme; } catch {}
    </script>
  </head>
  <body>
    <svg class="sprite" aria-hidden="true" focusable="false">
      <defs>
    <radialGradient id="pt-skin" cx="40%" cy="30%" r="78%">
      <stop offset="0" stop-color="#f4d496"/>
      <stop offset=".38" stop-color="#dcaa62"/>
      <stop offset=".72" stop-color="#b47c38"/>
      <stop offset="1" stop-color="#6f4419"/>
    </radialGradient>
    <radialGradient id="pt-shine" cx="34%" cy="24%" r="34%">
      <stop offset="0" stop-color="#fff8e4" stop-opacity=".8"/>
      <stop offset="1" stop-color="#fff8e4" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="pt-eye" cx="50%" cy="45%" r="50%">
      <stop offset="0" stop-color="#4b2a0b"/>
      <stop offset=".55" stop-color="#77481a"/>
      <stop offset="1" stop-color="#a8733a" stop-opacity="0"/>
    </radialGradient>
    <filter id="pt-texture" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="1.8" numOctaves="2" seed="11" result="noise"/>
      <feColorMatrix in="noise" type="matrix" values="0 0 0 0 .32  0 0 0 0 .18  0 0 0 0 .06  4 0 0 0 -2.45" result="specks"/>
      <feComposite in="specks" in2="SourceGraphic" operator="in" result="skin"/>
      <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="3" seed="4" result="blotch"/>
      <feColorMatrix in="blotch" type="matrix" values="0 0 0 0 .45  0 0 0 0 .27  0 0 0 0 .08  2.2 0 0 0 -1.15" result="blotchColor"/>
      <feComposite in="blotchColor" in2="SourceGraphic" operator="in" result="patches"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="patches"/><feMergeNode in="skin"/></feMerge>
    </filter>
    <filter id="pt-blur" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
      <symbol id="potato" viewBox="0 0 142 100">
  <ellipse cx="72" cy="92" rx="54" ry="4.5" fill="#000" opacity=".45" filter="url(#pt-blur)"/>
  <path filter="url(#pt-texture)" fill="url(#pt-skin)" d="M11 57C5 40 19 24 41 19c14-3 24 1 38-2 25-5 50 6 54 26 3 18-9 31-27 37-18 6-38 7-58 5-24-2-31-11-37-28Z"/>
  <path fill="url(#pt-shine)" d="M11 57C5 40 19 24 41 19c14-3 24 1 38-2 25-5 50 6 54 26 3 18-9 31-27 37-18 6-38 7-58 5-24-2-31-11-37-28Z"/>
  <g>
    <ellipse cx="45.6" cy="38" rx="3.4" ry="2.2" fill="url(#pt-eye)"/><path d="M41.5 40.4q4 2 8 0" stroke="#f7dcaa" stroke-opacity=".55" stroke-width=".9" fill="none" stroke-linecap="round"/>
    <ellipse cx="92.4" cy="27" rx="2.8" ry="1.8" fill="url(#pt-eye)"/><path d="M89.2 29q3.2 1.6 6.4 0" stroke="#f7dcaa" stroke-opacity=".5" stroke-width=".8" fill="none" stroke-linecap="round"/>
    <ellipse cx="106.5" cy="60" rx="3.2" ry="2" fill="url(#pt-eye)"/><path d="M102.7 62.2q3.6 1.8 7.2 0" stroke="#f7dcaa" stroke-opacity=".35" stroke-width=".8" fill="none" stroke-linecap="round"/>
    <ellipse cx="65.5" cy="72" rx="3.6" ry="2.3" fill="url(#pt-eye)"/><path d="M61.3 74.5q4 2 8 0" stroke="#f7dcaa" stroke-opacity=".35" stroke-width=".8" fill="none" stroke-linecap="round"/>
    <ellipse cx="29.2" cy="60" rx="2.4" ry="1.6" fill="url(#pt-eye)"/>
    <ellipse cx="73.7" cy="46" rx="1.8" ry="1.2" fill="url(#pt-eye)" opacity=".8"/>
  </g>
  <g fill="#6b4118" opacity=".55">
    <circle cx="56.2" cy="26" r=".9"/><circle cx="81.9" cy="40" r=".7"/><circle cx="36.3" cy="49" r=".8"/><circle cx="98.3" cy="45" r=".9"/><circle cx="86.6" cy="72" r=".8"/><circle cx="50.3" cy="62" r=".7"/><circle cx="114.7" cy="37" r=".7"/>
  </g>
</symbol>
          <!-- Ícones (Lucide, licença ISC; "desligar" é o call_end do Material Icons, Apache 2.0) -->
      <symbol id="i-phone" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></symbol>
      <symbol id="i-hangup" viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></symbol>
      <symbol id="i-video" viewBox="0 0 24 24"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></symbol>
      <symbol id="i-video-off" viewBox="0 0 24 24"><path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><path d="m2 2 20 20"/></symbol>
      <symbol id="i-mic" viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></symbol>
      <symbol id="i-mic-off" viewBox="0 0 24 24"><path d="m2 2 20 20"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M12 19v3"/></symbol>
      <symbol id="i-monitor-up" viewBox="0 0 24 24"><path d="m9 10 3-3 3 3"/><path d="M12 13V7"/><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4"/><path d="M8 21h8"/></symbol>
      <symbol id="i-monitor-off" viewBox="0 0 24 24"><path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="m22 3-5 5"/><path d="m17 3 5 5"/></symbol>
      <symbol id="i-message" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></symbol>
      <symbol id="i-message-off" viewBox="0 0 24 24"><path d="M21 15V5a2 2 0 0 0-2-2H9"/><path d="m2 2 20 20"/><path d="M3.6 3.6c-.4.3-.6.8-.6 1.4v16l4-4h10"/></symbol>
      <symbol id="i-maximize" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></symbol>
      <symbol id="i-minimize" viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></symbol>
      <symbol id="i-volume" viewBox="0 0 24 24"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></symbol>
      <symbol id="i-volume-off" viewBox="0 0 24 24"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></symbol>
      <symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></symbol>
      <symbol id="i-bell-off" viewBox="0 0 24 24"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></symbol>
      <symbol id="i-logout" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></symbol>
      <symbol id="i-arrow-right" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></symbol>
      <symbol id="i-arrow-left" viewBox="0 0 24 24"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></symbol>
      <symbol id="i-send" viewBox="0 0 24 24"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></symbol>
      <symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></symbol>
      <symbol id="i-chevron-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
      <symbol id="i-chevron-left" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></symbol>
      <symbol id="i-captions" viewBox="0 0 24 24"><rect width="18" height="14" x="3" y="5" rx="2" ry="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/></symbol>
      <symbol id="i-reply" viewBox="0 0 24 24"><path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></symbol>
      <symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></symbol>
      <symbol id="i-paperclip" viewBox="0 0 24 24"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></symbol>
      <symbol id="i-image" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></symbol>
      <symbol id="i-file" viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></symbol>
      <symbol id="i-download" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></symbol>
      <symbol id="i-pip" viewBox="0 0 24 24"><path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/><rect x="12" y="13" width="10" height="7" rx="2"/></symbol>
      <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></symbol>
      <symbol id="i-moon" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></symbol>
      <symbol id="i-droplet" viewBox="0 0 24 24"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></symbol>
      <symbol id="i-palette" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.96 6.01 17.46 2 12 2z"/><circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/></symbol>
      <symbol id="i-play" viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/></symbol>
      <symbol id="i-pause" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1.2" fill="currentColor" stroke="none"/></symbol>
      <symbol id="i-skip" viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M5 5.5v13a1 1 0 0 0 1.55.83l9.6-6.5a1 1 0 0 0 0-1.66l-9.6-6.5A1 1 0 0 0 5 5.5Z"/><path d="M19 5v14"/></symbol>
      <symbol id="i-stop" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/></symbol>
      <symbol id="i-music" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></symbol>
      <symbol id="i-skip-back" viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M19 5.5v13a1 1 0 0 1-1.55.83l-9.6-6.5a1 1 0 0 1 0-1.66l9.6-6.5A1 1 0 0 1 19 5.5Z"/><path d="M5 5v14"/></symbol>
      <symbol id="i-headphones" viewBox="0 0 24 24"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></symbol>
      <symbol id="i-list-music" viewBox="0 0 24 24"><path d="M21 15V6"/><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/></symbol>
      <symbol id="i-rotate-ccw" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></symbol>
      <symbol id="i-external" viewBox="0 0 24 24"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></symbol>
      <symbol id="i-tv" viewBox="0 0 24 24"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><path d="m17 2-5 5-5-5"/></symbol>
      <!-- Logo da Twitch (Simple Icons, CC0) -->
      <symbol id="b-twitch" viewBox="0 0 24 24"><path fill="#9146ff" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></symbol>
      <symbol id="i-volume-1" viewBox="0 0 24 24"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/></symbol>
      <!-- Logos do YouTube e do Spotify (Simple Icons, CC0), nas cores das marcas -->
      <symbol id="b-youtube" viewBox="0 0 24 24"><path fill="#ff0033" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><path fill="#fff" d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></symbol>
      <symbol id="b-spotify" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1ed760"/><path fill="#000" d="M17.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></symbol>
      <symbol id="i-copy" viewBox="0 0 24 24"><rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
      <symbol id="i-check-check" viewBox="0 0 24 24"><path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/></symbol>
      <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></symbol>
      <symbol id="i-alert" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></symbol>
      <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></symbol>
      <symbol id="i-check-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></symbol>
      <symbol id="i-x-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></symbol>
      <symbol id="i-radio" viewBox="0 0 24 24"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></symbol>
      <symbol id="i-user" viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></symbol>
      <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></symbol>
      <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></symbol>
      <symbol id="i-caps" viewBox="0 0 24 24"><path d="M9 18v-6H5l7-7 7 7h-4v6H9z"/></symbol>
      <symbol id="i-loader" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></symbol>
      <symbol id="i-camera" viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></symbol>
      <symbol id="i-settings" viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></symbol>
      <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></symbol>
    </svg>
    <div class="ambient" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="grain" aria-hidden="true"></div>
    <div id="fx" class="fx-layer" aria-hidden="true"></div>
    <div id="toasts" class="toasts" role="status" aria-live="polite"></div>

    <!-- ===================== LOGIN ===================== -->
    <main id="login-view" class="login-shell">
      <section class="login-panel">
        <button class="hero-potato" type="button" aria-label="Batata (clique!)"><svg viewBox="0 0 142 100"><use href="#potato" /></svg></button>
        <p class="eyebrow">Só a gente</p>
        <h1><span class="line">Bem-vindo ao</span> <span class="line"><em>nosso chat.</em></span></h1>
        <p class="lead">Mensagens, voz, vídeo e tela compartilhada — tudo num cantinho só nosso.</p>
        <form id="login-form">
          <label>Seu nome
            <span class="field">
              <svg class="icon"><use href="#i-user" /></svg>
              <input id="name" name="name" minlength="2" maxlength="24" autocomplete="nickname" placeholder="Como você quer aparecer" required />
            </span>
          </label>
          <label>Sua senha
            <span class="field">
              <svg class="icon"><use href="#i-lock" /></svg>
              <input id="password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required />
              <button id="peek" class="peek" type="button" aria-label="Mostrar senha" title="Mostrar senha">
                <svg class="icon when-hidden"><use href="#i-eye" /></svg>
                <svg class="icon when-shown"><use href="#i-eye-off" /></svg>
              </button>
            </span>
          </label>
          <!-- Só no primeiro acesso: a senha é repetida antes de a conta ser criada. -->
          <label id="again-wrap" class="hidden">Repita a senha
            <span class="field">
              <svg class="icon"><use href="#i-lock" /></svg>
              <input id="password-again" name="password-again" type="password" autocomplete="new-password" placeholder="••••••••" />
            </span>
          </label>
          <p id="caps" class="caps hidden"><svg class="icon"><use href="#i-caps" /></svg>Caps Lock está ligado</p>
          <p id="login-hint" class="hint hidden"></p>
          <p id="login-error" class="error" role="alert"></p>
          <button class="primary" type="submit">
            <span class="label">Entrar no nosso chat</span>
            <svg class="icon arrow"><use href="#i-arrow-right" /></svg>
            <svg class="icon spin"><use href="#i-loader" /></svg>
          </button>
        </form>
      </section>
    </main>

    <!-- ===================== CHAT ===================== -->
    <main id="chat-view" class="app-shell hidden" data-tab="chat">
      <aside class="sidebar">
        <div>
          <div class="brand-row"><svg class="potato-mini" viewBox="0 0 142 100" aria-hidden="true"><use href="#potato" /></svg><strong>Potato</strong></div>
          <div class="room-label">No nosso chat</div>
          <div id="people" class="people"></div>
        </div>
        <!-- Seu perfil: foto, tema, notificações, sons e sair ficam todos na aba Perfil. -->
        <div class="sidebar-bottom">
          <button id="side-profile" class="person side-profile" type="button" data-tab-target="profile">
            <span id="side-avatar" class="avatar" aria-hidden="true">?</span>
            <span><strong id="side-name">Você</strong><small>Ver seu perfil</small></span>
            <svg class="icon person-edit"><use href="#i-settings" /></svg>
          </button>
        </div>
      </aside>

      <section class="conversation">
        <!-- Papel de parede da conversa (a foto, a iluminação e a cor do tema vêm do app.js). -->
        <div class="wallpaper" aria-hidden="true"><i class="wall-photo"></i><i class="wall-shade"></i></div>
        <header class="topbar">
          <!-- Tocar no nome ou na foto abre o perfil da outra pessoa. -->
          <div id="peer-open" class="peer" role="button" tabindex="0" aria-haspopup="dialog" aria-controls="peer-profile">
            <div id="peer-avatar" class="avatar" aria-hidden="true">?</div>
            <div class="peer-text">
              <h2 id="room-title">Aguardando alguém</h2>
              <p id="peer-status" class="peer-status">Conectando…</p>
            </div>
          </div>
          <div class="actions">
            <button id="audio-call" class="icon-button" type="button" title="Chamada de voz" data-title="Chamada de voz" aria-label="Iniciar chamada de voz">
              <svg class="icon"><use href="#i-phone" /></svg>
            </button>
            <button id="video-call" class="icon-button" type="button" title="Chamada de vídeo" data-title="Chamada de vídeo" aria-label="Iniciar chamada de vídeo">
              <svg class="icon"><use href="#i-video" /></svg>
            </button>
            <button id="share-screen" class="icon-button" type="button" title="Transmitir tela" data-title="Transmitir tela" aria-label="Transmitir tela">
              <svg class="icon"><use href="#i-monitor-up" /></svg>
            </button>
            <button id="watch-button" class="icon-button watch-button" type="button" title="Batata Watch Party" aria-label="Abrir a Batata Watch Party" aria-pressed="false">
              <svg class="icon"><use href="#i-tv" /></svg>
              <span class="watch-dot" aria-hidden="true"></span>
            </button>
            <button id="music-button" class="icon-button music-button hidden" type="button" title="Música tocando" aria-label="Abrir o tocador de música" aria-expanded="false" aria-controls="music-panel">
              <span id="music-mini-art" class="mini-art" aria-hidden="true"></span>
              <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
              <span class="music-alert" aria-hidden="true"></span>
            </button>
          </div>
        </header>

        <div id="net-banner" class="net-banner hidden"><span class="spinner"></span><span id="net-text">Reconectando…</span></div>

        <!-- Chamada (estilo Discord) -->
        <div id="call-panel" class="call-panel hidden">
          <div id="stage" class="stage">
            <div id="stream-tile" class="tile stream hidden">
              <video id="stream-video" autoplay playsinline></video>
              <span class="live-badge"><i></i>AO VIVO</span>
              <span id="stream-owner" class="tile-name"></span>
              <div class="stream-tools">
                <label id="stream-volume-wrap" class="volume" title="Volume da transmissão">
                  <svg class="icon"><use href="#i-volume" /></svg>
                  <input id="stream-volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume da transmissão" />
                </label>
                <button id="stream-pip" class="tile-button hidden" type="button" title="Janelinha flutuante (assistir enquanto faz outra coisa)" aria-label="Janelinha flutuante">
                  <svg class="icon"><use href="#i-pip" /></svg>
                </button>
                <button id="stream-full" class="tile-button" type="button" title="Tela cheia (ou duplo clique)" aria-label="Tela cheia">
                  <svg class="icon"><use href="#i-maximize" /></svg>
                </button>
              </div>
            </div>
            <div class="tiles">
              <div id="tile-me" class="tile person-tile">
                <video id="local-video" autoplay playsinline muted></video>
                <div id="me-face" class="avatar big">?</div>
                <span class="mute-badge"><svg class="icon"><use href="#i-mic-off" /></svg></span>
                <span class="tile-name"><svg class="icon"><use href="#i-mic-off" /></svg><span>Você</span><b class="live-tag">AO VIVO</b></span>
              </div>
              <div id="tile-peer" class="tile person-tile">
                <video id="remote-video" autoplay playsinline muted></video>
                <div id="call-avatar-face" class="avatar big">?</div>
                <span class="mute-badge"><svg class="icon"><use href="#i-mic-off" /></svg></span>
                <span class="tile-name"><svg class="icon"><use href="#i-mic-off" /></svg><span id="peer-tile-name"></span><b class="live-tag">AO VIVO</b></span>
              </div>
            </div>
            <!-- Sua transmissão: prévia pequena no canto (para conferir o que a outra pessoa está vendo). -->
            <div id="my-stream" class="my-stream hidden">
              <video autoplay playsinline muted></video>
              <span class="live-badge"><i></i>VOCÊ AO VIVO</span>
              <button id="stop-stream" class="stop-stream" type="button" title="Parar a transmissão"><svg class="icon"><use href="#i-monitor-off" /></svg>Parar</button>
            </div>
          </div>
          <audio id="remote-audio" autoplay></audio>
          <div class="call-bar">
            <div class="call-info"><span class="call-dot"></span><span id="call-status">Preparando chamada…</span><span id="call-timer" class="call-timer"></span><span id="live-pill" class="live-pill hidden"></span></div>
            <div class="call-buttons">
              <button id="toggle-mic" class="round swap" type="button" title="Silenciar microfone" aria-label="Microfone">
                <svg class="icon when-on"><use href="#i-mic" /></svg>
                <svg class="icon when-off"><use href="#i-mic-off" /></svg>
              </button>
              <button id="toggle-cam" class="round swap is-off" type="button" title="Ligar câmera" aria-label="Câmera">
                <svg class="icon when-on"><use href="#i-video" /></svg>
                <svg class="icon when-off"><use href="#i-video-off" /></svg>
              </button>
              <button id="toggle-live" class="round swap is-off" type="button" title="Transmitir tela" aria-label="Transmitir tela">
                <svg class="icon when-on"><use href="#i-monitor-off" /></svg>
                <svg class="icon when-off"><use href="#i-monitor-up" /></svg>
              </button>
              <button id="toggle-chat" class="round swap" type="button" title="Esconder o chat" aria-label="Mostrar ou esconder o chat">
                <svg class="icon when-on"><use href="#i-message" /></svg>
                <svg class="icon when-off"><use href="#i-message-off" /></svg>
              </button>
              <button id="end-call" class="round hangup" type="button" title="Desligar" aria-label="Desligar">
                <svg class="icon"><use href="#i-hangup" /></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Assistir junto: um vídeo para os dois (YouTube, Twitch ou do aparelho), com o mesmo play/pause. -->
        <div id="watch-panel" class="watch-panel hidden" aria-label="Watch Party">
          <header class="watch-head">
            <span class="watch-badge"><svg class="potato-mark" viewBox="0 0 142 100" aria-hidden="true"><use href="#potato" /></svg>Batata Watch Party</span>
            <span id="watch-who" class="watch-who"></span>
            <button id="watch-leave" class="watch-btn" type="button" title="Sair da sala (o vídeo continua para a outra pessoa)" aria-label="Sair da sala"><svg class="icon"><use href="#i-logout" /></svg></button>
          </header>
          <div id="watch-stage" class="watch-stage">
            <div id="watch-host" class="watch-host"></div>
            <!-- Nada passando: o catálogo, como no Rave. Primeiro os serviços; cada um abre a tela dele. -->
            <div id="watch-picker" class="watch-picker hidden">
              <div id="watch-home" class="watch-home">
                <span class="watch-picker-icon"><svg viewBox="0 0 142 100" aria-hidden="true"><use href="#potato" /></svg></span>
                <strong>O que vamos assistir?</strong>
                <p id="watch-browsing" class="watch-browsing hidden"></p>
                <!-- No celular, a fileira passa para o lado. -->
                <div class="watch-sources" aria-label="Onde escolher">
                  <button type="button" class="watch-source" data-watch-source="youtube"><svg class="brand" aria-hidden="true"><use href="#b-youtube" /></svg><span>YouTube</span></button>
                  <button type="button" class="watch-source" data-watch-source="netflix"><b class="wordmark netflix">NETFLIX</b><span>Netflix</span></button>
                  <button type="button" class="watch-source" data-watch-source="max"><b class="wordmark max">max</b><span>HBO Max</span></button>
                  <button type="button" class="watch-source" data-watch-source="twitch"><svg class="brand" aria-hidden="true"><use href="#b-twitch" /></svg><span>Twitch</span></button>
                  <button type="button" class="watch-source" data-watch-source="local"><svg class="icon"><use href="#i-file" /></svg><span>Do aparelho</span></button>
                </div>
                <section id="watch-recent" class="watch-recent hidden" aria-label="Vistos por vocês">
                  <h3>Vistos por vocês</h3>
                  <div id="watch-recent-list" class="watch-row"></div>
                </section>
              </div>
              <!-- YouTube: o catálogo dentro da sala (prateleiras e busca). Tocar num vídeo começa para os dois. -->
              <div id="watch-catalog" class="watch-catalog hidden">
                <div class="catalog-head">
                  <button class="watch-btn" type="button" data-watch-back title="Voltar" aria-label="Voltar"><svg class="icon"><use href="#i-arrow-left" /></svg></button>
                  <svg class="brand" aria-hidden="true"><use href="#b-youtube" /></svg>
                  <form id="catalog-form" class="catalog-search" role="search">
                    <input id="catalog-query" type="search" autocomplete="off" enterkeyhint="search" placeholder="Pesquisar no YouTube" aria-label="Pesquisar no YouTube" />
                    <button type="submit" title="Pesquisar" aria-label="Pesquisar"><svg class="icon"><use href="#i-search" /></svg></button>
                  </form>
                </div>
                <div id="catalog-shelves" class="catalog-shelves" aria-label="Prateleiras"></div>
                <div id="catalog-grid" class="catalog-grid" aria-live="polite"></div>
              </div>
              <!-- Netflix, HBO Max e Twitch: abre o serviço e a sala segue o que for escolhido lá. -->
              <div id="watch-launch" class="watch-launch hidden">
                <button class="watch-btn launch-back" type="button" data-watch-back title="Voltar" aria-label="Voltar"><svg class="icon"><use href="#i-arrow-left" /></svg></button>
                <span id="watch-launch-mark" class="launch-mark"></span>
                <strong id="watch-launch-title"></strong>
                <p id="watch-launch-text" class="watch-hint"></p>
                <div id="watch-launch-actions" class="launch-actions">
                  <a id="watch-launch-open" class="music-pill" href="https://www.netflix.com/browse" target="_blank" rel="noopener noreferrer"><svg class="icon"><use href="#i-external" /></svg><span>Abrir a Netflix</span></a>
                  <button id="watch-launch-start" class="watch-ghost" type="button" title="Sem a extensão (no celular): a sala começa a contar o tempo para os dois"><svg class="icon"><use href="#i-play" /></svg>Começar a sessão</button>
                </div>
                <form id="watch-twitch" class="watch-form hidden">
                  <input id="watch-twitch-query" type="search" autocomplete="off" enterkeyhint="go" placeholder="Nome do canal" aria-label="Nome do canal da Twitch ou link de um vídeo" />
                  <button class="music-pill" type="submit" title="Assistir" aria-label="Assistir"><svg class="icon"><use href="#i-play" /></svg><span>Assistir</span></button>
                </form>
                <section id="watch-launch-seen" class="watch-recent hidden" aria-label="Vistos por vocês aqui">
                  <h3>Vistos por vocês</h3>
                  <div id="watch-launch-recent" class="watch-row"></div>
                </section>
              </div>
            </div>
            <div id="watch-stream" class="watch-stream hidden">
              <b id="watch-stream-mark" class="wordmark"></b>
              <strong id="watch-stream-title"></strong>
              <span id="watch-stream-clock" class="watch-stream-clock">0:00</span>
              <span id="watch-stream-state" class="watch-stream-state"></span>
              <div class="watch-stream-actions">
                <a id="watch-stream-open" class="music-pill" href="https://www.netflix.com/" target="_blank" rel="noopener noreferrer"><svg class="icon"><use href="#i-external" /></svg><span>Abrir na Netflix</span></a>
                <button id="watch-countdown" class="watch-ghost" type="button" title="Contagem nos dois aparelhos ao mesmo tempo, para darem o play juntos"><svg class="icon"><use href="#i-play" /></svg>Contagem 3, 2, 1</button>
              </div>
              <p id="watch-stream-note" class="watch-stream-note"></p>
            </div>
            <div id="watch-count" class="watch-count hidden" aria-live="assertive"><span id="watch-count-number"></span><small>deem o play juntos</small></div>
            <div id="watch-need" class="watch-need hidden">
              <svg class="icon"><use href="#i-file" /></svg>
              <p><strong id="watch-need-name"></strong>Esse vídeo está no aparelho de quem começou. Escolha o mesmo arquivo no seu para assistirem juntos.</p>
              <button id="watch-pick" class="music-pill" type="button"><svg class="icon"><use href="#i-file" /></svg>Escolher o vídeo</button>
            </div>
            <button id="watch-unblock" class="music-unblock hidden" type="button"><svg class="icon"><use href="#i-play" /></svg>Toque no play para assistir junto</button>
          </div>
          <div class="watch-bar">
            <button id="watch-toggle" class="watch-btn swap" type="button" title="Pausar para os dois" aria-label="Tocar ou pausar">
              <svg class="icon when-on"><use href="#i-pause" /></svg>
              <svg class="icon when-off"><use href="#i-play" /></svg>
            </button>
            <div class="watch-info">
              <span class="watch-title"><svg class="brand" aria-hidden="true"><use id="watch-logo" href="#b-youtube" /></svg><strong id="watch-title"></strong></span>
              <div class="watch-progress">
                <span id="watch-time">0:00</span>
                <input id="watch-seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Posição do vídeo" />
                <span id="watch-length">0:00</span>
              </div>
              <span id="watch-live" class="watch-live hidden"><i></i>AO VIVO</span>
            </div>
            <button id="watch-full" class="watch-btn" type="button" title="Tela cheia" aria-label="Tela cheia"><svg class="icon"><use id="watch-full-icon" href="#i-maximize" /></svg></button>
            <button id="watch-close" class="watch-btn danger" type="button" title="Parar para os dois" aria-label="Parar o vídeo para os dois"><svg class="icon"><use href="#i-x" /></svg></button>
          </div>
        </div>

        <div class="messages-wrap">
          <div id="messages" class="messages" aria-live="polite">
            <button id="load-more" class="load-more hidden" type="button">Carregar mensagens anteriores</button>
          </div>
          <div id="day-float" class="day day-float hidden" aria-hidden="true"></div>
          <!-- Arrastar arquivos para cima da conversa envia. -->
          <div id="drop-zone" class="drop-zone hidden" aria-hidden="true"><span><svg class="icon"><use href="#i-paperclip" /></svg>Solte para enviar</span></div>
          <button id="jump" class="jump hidden" type="button" aria-label="Ir para a última mensagem">
            <svg class="icon"><use href="#i-chevron-down" /></svg>
            <span id="jump-count" class="jump-count hidden">0</span>
          </button>
        </div>

        <div id="typing" class="typing" aria-live="polite">
          <div class="typing-bubble"><i></i><i></i><i></i><svg class="icon typing-mic"><use href="#i-mic" /></svg></div><span id="typing-text"></span>
        </div>

        <div id="reply-bar" class="reply-bar hidden">
          <svg class="icon reply-icon"><use href="#i-reply" /></svg>
          <div><strong id="reply-name"></strong><p id="reply-text"></p></div>
          <button id="reply-cancel" type="button" aria-label="Cancelar resposta" title="Cancelar resposta">
            <svg class="icon"><use href="#i-x" /></svg>
          </button>
        </div>

        <form id="message-form" class="composer">
          <!-- Busca de GIFs (GIPHY): abre em cima do campo de mensagem. -->
          <div id="gif-panel" class="gif-panel hidden" role="dialog" aria-label="Escolher um GIF">
            <label class="gif-search">
              <svg class="icon"><use href="#i-search" /></svg>
              <input id="gif-search" type="search" maxlength="50" autocomplete="off" enterkeyhint="search" placeholder="Buscar GIFs" aria-label="Buscar GIFs" />
            </label>
            <div id="gif-results" class="gif-results">
              <div id="gif-grid" class="gif-grid"></div>
              <p id="gif-note" class="gif-note hidden"></p>
            </div>
            <p class="gif-credit">Powered by GIPHY</p>
          </div>
          <div class="quick-emojis" role="group" aria-label="Enviar emoji rápido">
            <button type="button" data-emoji="❤️" title="Enviar ❤️">❤️</button><button type="button" data-emoji="😂" title="Enviar 😂">😂</button><button type="button" data-emoji="🥔" title="Enviar 🥔">🥔</button>
          </div>
          <div id="command-menu" class="command-menu hidden" role="listbox" aria-label="Comandos"></div>
          <!-- Fotos e arquivos: o menu escolhe entre a galeria (foto/vídeo, com câmera no celular) e qualquer arquivo. -->
          <div id="attach-menu" class="attach-menu hidden" role="menu" aria-label="Anexar">
            <button type="button" role="menuitem" data-pick="#pick-media"><span class="attach-icon media"><svg class="icon"><use href="#i-image" /></svg></span>Foto ou vídeo</button>
            <button type="button" role="menuitem" data-pick="#pick-file"><span class="attach-icon doc"><svg class="icon"><use href="#i-file" /></svg></span>Arquivo</button>
            <button type="button" role="menuitem" data-pick="#watch-button"><span class="attach-icon watch"><svg class="icon"><use href="#i-tv" /></svg></span>Batata Watch Party</button>
          </div>
          <input id="pick-media" type="file" accept="image/*,video/*" multiple hidden />
          <input id="pick-file" type="file" multiple hidden />
          <input id="pick-watch" type="file" accept="video/*" hidden />
          <button id="attach-button" class="attach-button" type="button" title="Enviar foto ou arquivo" aria-label="Enviar foto ou arquivo" aria-haspopup="menu" aria-expanded="false" aria-controls="attach-menu">
            <svg class="icon"><use href="#i-paperclip" /></svg>
          </button>
          <button id="gif-button" class="gif-button" type="button" title="Enviar GIF" aria-label="Enviar GIF" aria-haspopup="dialog" aria-expanded="false" aria-controls="gif-panel">GIF</button>
          <textarea id="message-input" rows="1" maxlength="2000" placeholder="Escreva uma mensagem…" aria-label="Mensagem"></textarea>
          <!-- Gravando um áudio: a faixa cobre o campo. Segurando o microfone, deslizar para a esquerda cancela. -->
          <div id="recorder" class="recorder hidden">
            <button id="rec-cancel" class="rec-cancel" type="button" title="Apagar o áudio" aria-label="Apagar o áudio"><svg class="icon"><use href="#i-trash" /></svg></button>
            <span class="rec-clock" role="timer" aria-label="Tempo de gravação"><i class="rec-dot"></i><span id="rec-time">0:00</span></span>
            <div id="rec-wave" class="rec-wave" aria-hidden="true"></div>
            <span id="rec-slide" class="rec-slide"><svg class="icon"><use href="#i-chevron-left" /></svg>Deslize para cancelar</span>
          </div>
          <button class="send" type="submit" aria-label="Enviar mensagem" title="Enviar">
            <svg class="icon"><use href="#i-send" /></svg>
          </button>
          <!-- Campo vazio: o microfone no lugar do enviar. Toque para gravar sem segurar, ou segure e solte para enviar. -->
          <button id="mic-button" class="mic" type="button" aria-label="Gravar áudio" title="Gravar áudio: toque para gravar, ou segure e solte para enviar">
            <svg class="icon when-mic"><use href="#i-mic" /></svg>
            <svg class="icon when-send"><use href="#i-send" /></svg>
          </button>
        </form>
      </section>

      <!-- ===================== MÚSICA (bot do /play) ===================== -->
      <!-- O tocador de verdade (YouTube ou Spotify) fica atrás da capa; fechado, o painel só sai da vista e a música continua. -->
      <section id="music-panel" class="music-panel closed" aria-label="Tocador de música">
        <div class="music-glow" aria-hidden="true"><img id="music-glow" alt="" /></div>
        <header class="music-head">
          <button id="music-close" class="music-round" type="button" aria-label="Fechar o tocador" title="Fechar (a música continua)">
            <svg class="icon"><use href="#i-chevron-down" /></svg>
          </button>
          <div class="music-where">
            <small id="music-state">Potato DJ</small>
            <strong><svg class="brand" aria-hidden="true"><use id="music-logo" href="#b-youtube" /></svg><span id="music-source">YouTube</span></strong>
          </div>
          <a id="music-open" class="music-round" href="https://www.youtube.com/" target="_blank" rel="noopener noreferrer" title="Abrir no YouTube" aria-label="Abrir no YouTube">
            <svg class="icon"><use href="#i-external" /></svg>
          </a>
        </header>
        <div id="music-hero" class="music-hero">
          <div id="music-stage" class="music-stage"></div>
          <img id="music-cover" class="music-cover" alt="" />
          <span class="music-cover-empty" aria-hidden="true"><svg class="icon"><use href="#i-music" /></svg></span>
          <div class="music-caption" aria-hidden="true"><strong id="music-caption-title"></strong><span id="music-caption-artist"></span></div>
          <button id="music-expand" class="music-expand" type="button" title="Ver em tela cheia" aria-label="Ver em tela cheia"><svg class="icon"><use id="music-expand-icon" href="#i-maximize" /></svg></button>
          <button id="music-unblock" class="music-unblock hidden" type="button"><svg class="icon"><use href="#i-headphones" /></svg>Toque no play para ouvir junto</button>
        </div>
        <div class="music-now">
          <div class="music-title-row">
            <div class="music-info">
              <strong id="music-title" class="marquee"><span></span></strong>
              <small><span id="music-preview" class="music-preview hidden" title="Sem login no Spotify, o player dele só toca 30 segundos">Prévia</span><span id="music-meta"></span></small>
            </div>
            <button id="music-video" class="music-round small" type="button" title="Ver o vídeo" aria-label="Ver o vídeo" aria-pressed="false">
              <svg class="icon"><use href="#i-video" /></svg>
            </button>
          </div>
          <div class="music-progress">
            <input id="music-seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Posição da música" />
            <div class="music-times"><span id="music-time">0:00</span><span id="music-length">0:00</span></div>
          </div>
          <div class="music-controls">
            <button id="music-stop" class="music-ctl" type="button" title="Parar e limpar a fila" aria-label="Parar e limpar a fila"><svg class="icon"><use href="#i-stop" /></svg></button>
            <button id="music-restart" class="music-ctl" type="button" title="Voltar ao começo" aria-label="Voltar ao começo"><svg class="icon"><use href="#i-skip-back" /></svg></button>
            <button id="music-toggle" class="music-ctl big swap" type="button" title="Pausar para os dois" aria-label="Tocar ou pausar">
              <svg class="icon when-on"><use href="#i-pause" /></svg>
              <svg class="icon when-off"><use href="#i-play" /></svg>
            </button>
            <button id="music-skip" class="music-ctl" type="button" title="Pular para a próxima" aria-label="Pular para a próxima"><svg class="icon"><use href="#i-skip" /></svg></button>
            <button id="music-list" class="music-ctl" type="button" title="Ver a fila" aria-label="Ver a fila"><svg class="icon"><use href="#i-list-music" /></svg></button>
          </div>
          <div class="music-volume">
            <button id="music-mute" class="music-round small" type="button" title="Tirar o som (só para você)" aria-label="Tirar o som"><svg class="icon"><use id="music-mute-icon" href="#i-volume" /></svg></button>
            <input id="music-volume" type="range" min="0" max="100" step="1" value="80" aria-label="Volume (só para você)" />
          </div>
        </div>
        <div class="music-empty">
          <span class="music-empty-art"><svg class="icon"><use href="#i-headphones" /></svg></span>
          <strong>Nada tocando</strong>
          <p>Escreva <b>/play</b> e o nome ou o link de uma música do YouTube ou do Spotify. Ela toca para os dois ao mesmo tempo.</p>
          <button id="music-try" class="music-pill" type="button"><svg class="icon"><use href="#i-play" /></svg>Escrever /play</button>
        </div>
        <div id="music-next" class="music-next hidden">
          <p class="music-label">A seguir <span id="music-count"></span></p>
          <ol id="music-queue" class="music-queue"></ol>
        </div>
        <p class="music-hint"><b>/play</b> nome ou link<i></i><b>/pause</b><i></i><b>/skip</b><i></i><b>/stop</b></p>
        <p class="music-tip"><svg class="icon"><use href="#i-info" /></svg>No celular, o YouTube só toca com o chat na tela (tocar com o app fechado é coisa do YouTube Premium). Enquanto a música toca, a tela fica acesa, e ao voltar ela continua de onde está.</p>
      </section>

      <!-- ===================== PERFIL ===================== -->
      <section id="profile-view" class="profile-view" aria-labelledby="profile-name">
        <header class="profile-top">
          <h2>Seu perfil</h2>
        </header>
        <div class="profile-scroll">
          <section class="profile-hero">
            <button id="profile-photo" class="profile-photo" type="button" aria-label="Escolher foto" title="Escolher foto">
              <span class="photo-ring" aria-hidden="true"></span>
              <span id="profile-face" class="avatar big">?</span>
              <span class="photo-badge"><svg class="icon"><use href="#i-camera" /></svg></span>
            </button>
            <h3 id="profile-name">Você</h3>
            <p id="profile-since" class="muted">Sua foto aparece para a outra pessoa na conversa e nas chamadas. Pode ser um GIF.</p>
            <div class="photo-actions">
              <button id="photo-pick" class="pill gold small" type="button"><svg class="icon"><use href="#i-camera" /></svg>Trocar foto</button>
              <button id="photo-remove" class="text-button hidden" type="button">Remover</button>
            </div>
            <input id="photo-input" type="file" accept="image/*" hidden />
          </section>

          <section class="profile-stats" aria-label="Seus números no chat">
            <div><strong data-stat="messages">–</strong><span>mensagens</span></div>
            <div><strong data-stat="reactions">–</strong><span>reações</span></div>
            <div><strong data-stat="days">–</strong><span>dias de conversa</span></div>
          </section>

          <section class="profile-card">
            <p class="picker-label">Tema <small>· só muda para você</small></p>
            <div id="themes" class="themes" role="group" aria-label="Tema do chat"></div>
          </section>

          <section class="profile-card">
            <p class="picker-label">Papel de parede <small>· só muda para você</small></p>
            <div class="wall-row">
              <button id="wall-thumb" class="wall-thumb" type="button" aria-label="Papel de parede" title="Papel de parede">
                <span class="wall-art" aria-hidden="true"><i class="wall-photo"></i><i class="wall-shade"></i></span>
                <span class="wall-mini" aria-hidden="true"><i></i><i class="mine"></i><i></i></span>
              </button>
              <div class="wall-text">
                <strong id="wall-state">Sem papel de parede</strong>
                <small>Uma foto no fundo da conversa, com a iluminação do jeito que você preferir.</small>
                <div class="photo-actions">
                  <button id="wall-choose" class="pill gold small" type="button"><svg class="icon"><use href="#i-image" /></svg><span>Escolher foto</span></button>
                  <button id="wall-adjust" class="text-button wall-adjust hidden" type="button">Ajustar</button>
                  <button id="wall-remove" class="text-button hidden" type="button">Remover</button>
                </div>
              </div>
            </div>
            <input id="wall-input" type="file" accept="image/*" hidden />
          </section>

          <section class="profile-card settings-list">
            <button id="toggle-notify" class="setting-row swap is-off" type="button" role="switch" aria-checked="false">
              <svg class="icon when-on"><use href="#i-bell" /></svg>
              <svg class="icon when-off"><use href="#i-bell-off" /></svg>
              <span class="setting-text"><strong>Notificações</strong><small id="notify-state">Desativadas</small></span>
              <span class="switch" aria-hidden="true"></span>
            </button>
            <button id="toggle-sound-setting" class="setting-row swap" type="button" role="switch" aria-checked="true">
              <svg class="icon when-on"><use href="#i-volume" /></svg>
              <svg class="icon when-off"><use href="#i-volume-off" /></svg>
              <span class="setting-text"><strong>Sons</strong><small class="sound-state">Ligados</small></span>
              <span class="switch" aria-hidden="true"></span>
            </button>
          </section>

          <section class="profile-card settings-list">
            <button class="setting-row logout" type="button" data-logout>
              <svg class="icon"><use href="#i-logout" /></svg>
              <span class="setting-text"><strong>Sair</strong><small>Encerrar a sessão neste aparelho</small></span>
            </button>
          </section>
        </div>
      </section>

      <!-- Abas do celular e do painel da extensão (como no Instagram). -->
      <nav class="tabbar" aria-label="Navegação">
        <span class="tab-glow" aria-hidden="true"></span>
        <button class="tab" type="button" data-tab-target="chat" aria-label="Conversa" title="Conversa">
          <svg class="icon"><use href="#i-message" /></svg>
          <span id="tab-unread" class="tab-badge unread-badge hidden">0</span>
        </button>
        <button class="tab" type="button" data-tab-target="profile" aria-label="Seu perfil" title="Seu perfil">
          <span id="tab-avatar" class="avatar" aria-hidden="true">?</span>
        </button>
      </nav>
    </main>

    <!-- ===================== JANELAS ===================== -->
    <div id="incoming" class="modal incoming hidden" role="dialog" aria-modal="true" aria-labelledby="incoming-title">
      <div class="modal-card incoming-card">
        <div class="incoming-avatar"><div class="ring"></div><div class="ring r2"></div><div class="ring r3"></div><div id="incoming-face" class="avatar big">?</div></div>
        <p class="eyebrow">Chamada recebida</p>
        <h3 id="incoming-title">Alguém está ligando</h3>
        <p id="incoming-kind" class="muted">Chamada de voz</p>
        <div class="modal-actions">
          <button id="decline-call" class="pill decline" type="button"><svg class="icon"><use href="#i-hangup" /></svg>Recusar</button>
          <button id="accept-call" class="pill accept" type="button"><svg class="icon"><use href="#i-phone" /></svg>Atender</button>
        </div>
      </div>
    </div>

    <!-- Papel de parede: prévia com balões de exemplo e os ajustes (iluminação, desfoque, cor do tema). -->
    <div id="wall-editor" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="wall-title">
      <div class="modal-card wall-card">
        <div class="wall-head">
          <h3 id="wall-title">Papel de parede</h3>
          <p class="muted">Só você vê. Vale no computador, no celular e na extensão.</p>
        </div>
        <div id="wall-preview" class="wall-preview">
          <span class="wall-art" aria-hidden="true"><i class="wall-photo"></i><i class="wall-shade"></i></span>
          <div class="wall-sample" aria-hidden="true">
            <span class="wall-day">Hoje</span>
            <p class="wall-bubble">Olha essa foto nossa 😍<time>21:04</time></p>
            <p class="wall-bubble mine">Virou o fundo do chat! 🥔<time>21:05</time></p>
          </div>
        </div>
        <div class="wall-controls">
          <label class="wall-slider light">
            <span class="wall-label"><svg class="icon"><use href="#i-sun" /></svg>Iluminação<output id="wall-light-out"></output></span>
            <input id="wall-light" type="range" min="-100" max="100" step="1" data-style="light" />
          </label>
          <label class="wall-slider">
            <span class="wall-label"><svg class="icon"><use href="#i-droplet" /></svg>Desfoque<output id="wall-blur-out"></output></span>
            <input id="wall-blur" type="range" min="0" max="20" step="1" data-style="blur" />
          </label>
          <label class="wall-slider">
            <span class="wall-label"><svg class="icon"><use href="#i-palette" /></svg>Cor do tema por cima<output id="wall-tint-out"></output></span>
            <input id="wall-tint" type="range" min="0" max="80" step="1" data-style="tint" />
          </label>
        </div>
        <div class="wall-tools">
          <button id="wall-repick" class="pill ghost small" type="button"><svg class="icon"><use href="#i-image" /></svg>Trocar foto</button>
          <button id="wall-reset" class="text-button wall-reset" type="button">Voltar ao padrão</button>
        </div>
        <div class="modal-actions">
          <button id="wall-cancel" class="pill ghost" type="button">Cancelar</button>
          <button id="wall-apply" class="pill gold" type="button">Aplicar</button>
        </div>
      </div>
    </div>

    <!-- Antes de transmitir: qualidade e som. O clique em Transmitir abre a escolha de tela do navegador. -->
    <div id="share-sheet" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <div class="modal-card share-card">
        <div class="modal-icon share-icon"><svg class="icon"><use href="#i-monitor-up" /></svg></div>
        <h3 id="share-title">Transmitir sua tela</h3>
        <p class="muted">Escolha a qualidade. Depois o navegador pergunta qual tela, janela ou aba mostrar.</p>
        <div id="share-options" class="share-options" role="radiogroup" aria-label="Qualidade da transmissão">
          <button type="button" role="radio" data-quality="720p"><strong>Leve</strong><small>720p · para internet mais fraca</small></button>
          <button type="button" role="radio" data-quality="1080p"><strong>Nítida</strong><small>1080p · textos, sites e filmes</small></button>
          <button type="button" role="radio" data-quality="1080p60"><strong>Fluida</strong><small>1080p a 60 fps · jogos e vídeos rápidos</small></button>
        </div>
        <button id="share-audio" class="setting-row swap" type="button" role="switch" aria-checked="true">
          <svg class="icon when-on"><use href="#i-volume" /></svg>
          <svg class="icon when-off"><use href="#i-volume-off" /></svg>
          <span class="setting-text"><strong>Incluir o som</strong><small>Do filme, jogo ou música que estiver tocando</small></span>
          <span class="switch" aria-hidden="true"></span>
        </button>
        <div class="modal-actions">
          <button id="share-cancel" class="pill ghost" type="button">Cancelar</button>
          <button id="share-go" class="pill share-go" type="button"><svg class="icon"><use href="#i-monitor-up" /></svg>Transmitir</button>
        </div>
      </div>
    </div>

    <!-- Perfil da outra pessoa: foto (toque para ampliar), status, números e atalhos. A foto ampliada abre por cima. -->
    <div id="peer-profile" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="peer-profile-name">
      <div class="modal-card peer-card">
        <button id="peer-profile-close" class="peer-close" type="button" title="Fechar" aria-label="Fechar"><svg class="icon"><use href="#i-x" /></svg></button>
        <button id="peer-profile-photo" class="profile-photo" type="button" aria-label="Ver a foto">
          <span class="photo-ring" aria-hidden="true"></span>
          <span id="peer-profile-face" class="avatar big">?</span>
        </button>
        <h3 id="peer-profile-name"></h3>
        <p id="peer-profile-status" class="peer-profile-status"></p>
        <section class="profile-stats" aria-label="Números no chat">
          <div><strong data-stat="messages">–</strong><span>mensagens</span></div>
          <div><strong data-stat="reactions">–</strong><span>reações</span></div>
          <div><strong data-stat="days">–</strong><span>dias de conversa</span></div>
        </section>
        <p id="peer-profile-since" class="muted peer-since"></p>
        <div class="peer-actions">
          <button type="button" data-peer-action="audio"><span><svg class="icon"><use href="#i-phone" /></svg></span>Voz</button>
          <button type="button" data-peer-action="video"><span><svg class="icon"><use href="#i-video" /></svg></span>Vídeo</button>
          <button type="button" data-peer-action="message"><span><svg class="icon"><use href="#i-message" /></svg></span>Mensagem</button>
        </div>
      </div>
    </div>

    <!-- Foto em tela cheia. -->
    <div id="viewer" class="viewer hidden" role="dialog" aria-modal="true" aria-label="Foto">
      <img id="viewer-img" alt="" />
      <div class="viewer-bar">
        <span id="viewer-name"></span>
        <a id="viewer-download" class="viewer-button" title="Baixar" aria-label="Baixar"><svg class="icon"><use href="#i-download" /></svg></a>
        <button id="viewer-close" class="viewer-button" type="button" title="Fechar" aria-label="Fechar"><svg class="icon"><use href="#i-x" /></svg></button>
      </div>
    </div>

    <div id="confirm" class="modal hidden" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text">
      <div class="modal-card">
        <div class="modal-icon"><svg class="icon"><use href="#i-trash" /></svg></div>
        <h3 id="confirm-title">Apagar mensagem?</h3>
        <p id="confirm-text" class="muted">Ela some para os dois. Não dá para desfazer.</p>
        <div class="modal-actions">
          <button id="confirm-cancel" class="pill ghost" type="button">Cancelar</button>
          <button id="confirm-ok" class="pill danger" type="button">Apagar</button>
        </div>
      </div>
    </div>

    <script src="vendor/gsap.min.js"></script>
    <script type="importmap">
      { "imports": { "./fx.js": "./<?= asset('fx.js') ?>", "./sound.js": "./<?= asset('sound.js') ?>", "./realtime.js": "./<?= asset('realtime.js') ?>", "./music.js": "./<?= asset('music.js') ?>", "./watch.js": "./<?= asset('watch.js') ?>" } }
    </script>
    <script type="module" src="<?= asset('app.js') ?>"></script>
  </body>
</html>
