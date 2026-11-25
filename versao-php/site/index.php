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
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=Caveat:wght@400;700&family=Dancing+Script:wght@400;700&family=Patrick+Hand&family=Special+Elite&display=swap" />
    <link rel="stylesheet" href="<?= asset('styles.css') ?>" />
    <link rel="stylesheet" href="<?= asset('emoji-picker.css') ?>" />
    <script>
      // Já logado: vai direto para o chat, sem piscar a tela de login.
      try { if (JSON.parse(localStorage.getItem("potato.session"))?.token) document.documentElement.classList.add("has-session"); } catch {}
      // Tema escolhido: aplicado antes de desenhar a página, sem piscar o tema padrão.
      try { const theme = JSON.parse(localStorage.getItem("potato.theme")); if (/^[a-z]+$/.test(theme)) document.documentElement.dataset.theme = theme; } catch {}
      // Letra e balões da conversa (só neste aparelho), também antes de desenhar.
      try { const look = JSON.parse(localStorage.getItem("potato.look")) || {}; for (const key of ["text", "bubbles"]) if (/^[a-z]+$/.test(look[key] || "")) document.documentElement.dataset[key] = look[key]; } catch {}
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
      <symbol id="i-phone-missed" viewBox="0 0 24 24"><path d="m16 2 6 6"/><path d="m22 2-6 6"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></symbol>
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
      <symbol id="i-chevron-up" viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></symbol>
      <symbol id="i-audio-lines" viewBox="0 0 24 24"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></symbol>
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
      <!-- Nosso cantinho e jogos (Lucide, licença ISC) -->
      <symbol id="i-sunrise" viewBox="0 0 24 24"><path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/></symbol>
      <symbol id="i-coffee" viewBox="0 0 24 24"><path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/></symbol>
      <symbol id="i-utensils" viewBox="0 0 24 24"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></symbol>
      <symbol id="i-cookie" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/><path d="M11 17v.01"/><path d="M7 14v.01"/></symbol>
      <symbol id="i-soup" viewBox="0 0 24 24"><path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z"/><path d="M7 21h10"/><path d="M19.5 12 22 6"/><path d="M16.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.73 1.62"/><path d="M11.25 3c.27.1.8.53.74 1.36-.05.83-.93 1.2-.98 2.02-.06.78.33 1.24.72 1.62"/><path d="M6.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.74 1.62"/></symbol>
      <symbol id="i-list-checks" viewBox="0 0 24 24"><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></symbol>
      <symbol id="i-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></symbol>
      <symbol id="i-book-open" viewBox="0 0 24 24"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></symbol>
      <symbol id="i-smile" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/></symbol>
      <symbol id="i-laugh" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M18 13a6 6 0 0 1-6 5 6 6 0 0 1-6-5h12Z"/><path d="M9 9h.01"/><path d="M15 9h.01"/></symbol>
      <symbol id="i-meh" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 15h8"/><path d="M9 9h.01"/><path d="M15 9h.01"/></symbol>
      <symbol id="i-frown" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><path d="M9 9h.01"/><path d="M15 9h.01"/></symbol>
      <symbol id="i-angry" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><path d="M7.5 8 10 9"/><path d="m14 9 2.5-1"/><path d="M9 10h.01"/><path d="M15 10h.01"/></symbol>
      <symbol id="i-thermometer" viewBox="0 0 24 24"><path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/></symbol>
      <symbol id="i-zap" viewBox="0 0 24 24"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></symbol>
      <symbol id="i-film" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></symbol>
      <symbol id="i-cake" viewBox="0 0 24 24"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3"/><path d="M12 8v3"/><path d="M17 8v3"/><path d="M7 4h.01"/><path d="M12 4h.01"/><path d="M17 4h.01"/></symbol>
      <symbol id="i-plane" viewBox="0 0 24 24"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></symbol>
      <symbol id="i-gift" viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></symbol>
      <symbol id="i-stethoscope" viewBox="0 0 24 24"><path d="M11 2v2"/><path d="M5 2v2"/><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/></symbol>
      <symbol id="i-graduation" viewBox="0 0 24 24"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/></symbol>
      <symbol id="i-briefcase" viewBox="0 0 24 24"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/></symbol>
      <symbol id="i-cart" viewBox="0 0 24 24"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></symbol>
      <symbol id="i-dumbbell" viewBox="0 0 24 24"><path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/></symbol>
      <symbol id="i-palmtree" viewBox="0 0 24 24"><path d="M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4"/><path d="M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3"/><path d="M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25.7-.7.71-.71 2.12-2.12c-1.95-1.96-5.27-1.8-7.42.35"/><path d="M11 15.5c.5 2.5-.17 4.5-1 6.5h4c2-5.5-.5-12-1-14"/></symbol>
      <symbol id="i-home" viewBox="0 0 24 24"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></symbol>
      <symbol id="i-dog" viewBox="0 0 24 24"><path d="M11.25 16.25h1.5L12 17z"/><path d="M16 14v.5"/><path d="M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.702 11.702 0 0 0-.493-3.309"/><path d="M8 14v.5"/><path d="M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5-1.931.722-3.576-.297-3.656-1-.113-.994 1.177-6.53 4-7 1.923-.321 3.651.845 3.651 2.235A7.497 7.497 0 0 1 14 5.277c0-1.39 1.844-2.598 3.767-2.277 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 1-1.261-.472-1.855-1.45-2.239-2.5"/></symbol>
      <symbol id="i-cat" viewBox="0 0 24 24"><path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75Z"/></symbol>
      <symbol id="i-gem" viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></symbol>
      <symbol id="i-car" viewBox="0 0 24 24"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></symbol>
      <symbol id="i-gamepad" viewBox="0 0 24 24"><path d="M6 12h4"/><path d="M8 10v4"/><path d="M15 13h.01"/><path d="M18 11h.01"/><rect width="20" height="12" x="2" y="6" rx="2"/></symbol>
      <symbol id="i-chef" viewBox="0 0 24 24"><path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z"/><path d="M6 17h12"/></symbol>
      <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></symbol>
      <symbol id="i-hash" viewBox="0 0 24 24"><path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="m16 3-2 18"/></symbol>
      <symbol id="i-crown" viewBox="0 0 24 24"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/></symbol>
      <symbol id="i-brain" viewBox="0 0 24 24"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/></symbol>
      <symbol id="i-hand" viewBox="0 0 24 24"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></symbol>
      <symbol id="i-user-plus" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></symbol>
      <symbol id="i-share" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/></symbol>
      <symbol id="i-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></symbol>
      <symbol id="i-split" viewBox="0 0 24 24"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/></symbol>
      <symbol id="i-question" viewBox="0 0 24 24"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></symbol>
      <symbol id="i-flame" viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></symbol>
      <symbol id="i-layout" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></symbol>
      <symbol id="i-connect" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.6"/><circle cx="12" cy="9" r="1.6"/><circle cx="16" cy="9" r="1.6"/><circle cx="8" cy="15" r="1.6"/><circle cx="12" cy="15" r="1.6"/><circle cx="16" cy="15" r="1.6"/></symbol>
      <symbol id="i-gallows" viewBox="0 0 24 24"><path d="M4 21h10M7 21V3h9v3"/><circle cx="16" cy="8.5" r="2.5"/><path d="M16 11v5M16 13l-2.5 2M16 13l2.5 2"/></symbol>
      <symbol id="i-align-left" viewBox="0 0 24 24"><path d="M21 5H3M15 12H3M17 19H3"/></symbol>
      <symbol id="i-align-center" viewBox="0 0 24 24"><path d="M21 5H3M17 12H7M19 19H5"/></symbol>
      <symbol id="i-align-right" viewBox="0 0 24 24"><path d="M21 5H3M21 12H9M21 19H7"/></symbol>
      <symbol id="i-align-justify" viewBox="0 0 24 24"><path d="M3 5h18M3 12h18M3 19h18"/></symbol>
      <symbol id="i-list" viewBox="0 0 24 24"><path d="M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13"/></symbol>
      <symbol id="i-list-ordered" viewBox="0 0 24 24"><path d="M10 5h11M10 12h11M10 19h11M4 4h1v5M4 9h2M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"/></symbol>
      <symbol id="i-undo" viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></symbol>
      <symbol id="i-redo" viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/></symbol>
      <symbol id="i-eraser" viewBox="0 0 24 24"><path d="M4 7V4h16v3M5 20h6M13 4 8 20M15 15l5 5M20 15l-5 5"/></symbol>
      <symbol id="i-highlighter" viewBox="0 0 24 24"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></symbol>
      <symbol id="i-layers" viewBox="0 0 24 24"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></symbol>
      <symbol id="i-frame" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10" rx="1"/></symbol>
      <symbol id="i-sticker" viewBox="0 0 24 24"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M14 3v4a2 2 0 0 0 2 2h4"/><path d="M8 13h.01M16 13h.01" stroke-width="2.5" stroke-linecap="round"/><path d="M10 16s.8 1 2 1c1.3 0 2-1 2-1"/></symbol>
      <symbol id="i-star" viewBox="0 0 24 24"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></symbol>
      <symbol id="i-pizza" viewBox="0 0 24 24"><path d="m12 14-1 1"/><path d="m13.75 18.25-1.25 1.42"/><path d="M17.775 5.654a15.68 15.68 0 0 0-12.121 12.12"/><path d="M18.8 9.3a1 1 0 0 0 2.1 7.7"/><path d="M21.964 20.732a1 1 0 0 1-1.232 1.232l-18-5a1 1 0 0 1-.695-1.232A19.68 19.68 0 0 1 15.732 2.037a1 1 0 0 1 1.232.695z"/></symbol>
      <symbol id="i-flower" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5"/><path d="M12 7.5V9"/><path d="M7.5 12H9"/><path d="M16.5 12H15"/><path d="M12 16.5V15"/><path d="m8 8 1.88 1.88"/><path d="M14.12 9.88 16 8"/><path d="m8 16 1.88-1.88"/><path d="M14.12 14.12 16 16"/></symbol>
      <symbol id="i-cloud" viewBox="0 0 24 24"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></symbol>
      <symbol id="i-fish" viewBox="0 0 24 24"><path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z"/><path d="M18 12v.5"/><path d="M16 17.93a9.77 9.77 0 0 1 0-11.86"/><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1.17 1.95-1.17 3.75 0 5.5 0 0 2.54 0 4.27-.33"/><path d="M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4"/><path d="m16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98"/></symbol>
      <symbol id="i-cherry" viewBox="0 0 24 24"><path d="M2 17a5 5 0 0 0 10 0c0-2.76-2.5-5-5-3-2.5-2-5 .24-5 3Z"/><path d="M12 17a5 5 0 0 0 10 0c0-2.76-2.5-5-5-3-2.5-2-5 .24-5 3Z"/><path d="M7 14c3.22-2.91 4.29-8.75 5-12 1.66 2.38 4.94 9 5 12"/><path d="M22 9c-4.29 0-7.14-2.33-10-7 5.71 0 10 4.67 10 7Z"/></symbol>
      <symbol id="i-send-heart" viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M12 5 9.04 7.96a2.17 2.17 0 0 0 0 3.08c.82.82 2.13.85 3 .07l2.07-1.9a2.82 2.82 0 0 1 3.79 0l2.96 2.66"/></symbol>
      <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></symbol>
      <symbol id="i-heart" viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></symbol>
      <symbol id="i-calendar" viewBox="0 0 24 24"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5v14"/></symbol>
      <symbol id="i-pencil" viewBox="0 0 24 24"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></symbol>
      <symbol id="i-chevron-right" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol>
      <symbol id="i-mail" viewBox="0 0 24 24"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></symbol>
      <symbol id="i-dice" viewBox="0 0 24 24"><rect width="12" height="12" x="2" y="10" rx="2" ry="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/></symbol>
      <symbol id="i-sparkles" viewBox="0 0 24 24"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></symbol>
      <symbol id="i-map-pin" viewBox="0 0 24 24"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></symbol>
      <symbol id="i-repeat" viewBox="0 0 24 24"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></symbol>
      <symbol id="i-piggy" viewBox="0 0 24 24"><path d="M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z"/><path d="M16 10h.01"/><path d="M2 8v1a2 2 0 0 0 2 2h1"/></symbol>
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
      <section id="call-dock" class="call-dock hidden" aria-label="Chamada em andamento">
        <button id="call-dock-open" class="call-dock-open" type="button" aria-controls="call-panel" aria-expanded="false">
          <span id="call-dock-avatar" class="avatar call-dock-avatar" aria-hidden="true">?</span>
          <span class="call-dock-copy"><span class="call-dock-meta"><span id="call-dock-status">Em chamada</span><time id="call-dock-timer" class="call-timer"></time></span><strong id="call-dock-name"></strong></span>
          <span class="call-dock-return" aria-hidden="true"><span>Voltar à chamada</span><svg class="icon"><use href="#i-chevron-up" /></svg></span>
        </button>
        <div class="call-dock-actions">
          <button id="call-dock-mic" class="round swap" type="button" aria-label="Silenciar microfone">
            <svg class="icon when-on"><use href="#i-mic" /></svg><svg class="icon when-off"><use href="#i-mic-off" /></svg>
          </button>
          <button id="call-dock-leave" class="round hangup" type="button" title="Sair da chamada" aria-label="Sair da chamada"><svg class="icon"><use href="#i-hangup" /></svg></button>
        </div>
      </section>
      <!-- Barra lateral: as conversas (os contatos e o Adicionar pessoa), as partes do Nosso cantinho (só do casal) e o
           perfil. No celular, vira uma gaveta (botão de menu). -->
      <aside id="sidebar" class="sidebar" aria-label="Menu">
        <div>
          <div class="brand-row"><svg class="potato-mini" viewBox="0 0 142 100" aria-hidden="true"><use href="#potato" /></svg><strong>Potato</strong></div>
          <div class="room-label">Conversas</div>
          <div id="people" class="people"></div>
          <div class="room-label couple-only">Nosso cantinho</div>
          <nav class="side-nav couple-only" aria-label="Nosso cantinho">
            <button class="side-link" type="button" data-us-open="hoje"><span class="side-icon" aria-hidden="true"><svg class="icon"><use href="#i-sun" /></svg></span><span class="side-text"><strong>Rotina do dia</strong><small>Acordar, refeições e hábitos</small></span></button>
            <button class="side-link" type="button" data-us-open="agenda"><span class="side-icon" aria-hidden="true"><svg class="icon"><use href="#i-calendar" /></svg></span><span class="side-text"><strong>Agenda</strong><small id="side-agenda">Os compromissos dos dois</small></span></button>
            <button class="side-link" type="button" data-us-open="sonhos"><span class="side-icon" aria-hidden="true"><svg class="icon"><use href="#i-sparkles" /></svg></span><span class="side-text"><strong>Sonhos e metas</strong><small>O que vamos realizar juntos</small></span></button>
            <button class="side-link" type="button" data-us-open="cartinhas"><span class="side-icon" aria-hidden="true"><svg class="icon"><use href="#i-mail" /></svg></span><span class="side-text"><strong>Cartinhas</strong><small>O nosso blog de cartas</small></span><b class="us-count letters-new hidden"></b></button>
            <button class="side-link" type="button" data-us-open="jogos"><span class="side-icon" aria-hidden="true"><svg class="icon"><use href="#i-dice" /></svg></span><span class="side-text"><strong>Jogos</strong><small>Velha, dama, memória, stop…</small></span><b class="us-count games-turn hidden"></b></button>
          </nav>
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
          <button class="menu-button" type="button" data-menu title="Menu" aria-label="Abrir o menu" aria-controls="sidebar" aria-expanded="false"><svg class="icon"><use href="#i-menu" /></svg><i class="menu-dot hidden" aria-hidden="true"></i></button>
          <!-- Tocar no nome ou na foto abre o perfil da outra pessoa. -->
          <div id="peer-open" class="peer" role="button" tabindex="0" aria-haspopup="dialog" aria-controls="peer-profile">
            <div id="peer-avatar" class="avatar" aria-hidden="true">?</div>
            <div class="peer-text">
              <h2 id="room-title">Ninguém aqui ainda</h2>
              <p id="peer-status" class="peer-status">Conectando…</p>
            </div>
          </div>
          <div class="actions">
            <button id="search-button" class="icon-button" type="button" title="Pesquisar na conversa" aria-label="Pesquisar na conversa" aria-expanded="false" aria-controls="search-panel">
              <svg class="icon"><use href="#i-search" /></svg>
            </button>
            <!-- Um botão só para ligar: o menu escolhe voz, vídeo ou transmitir a tela. -->
            <div class="call-pick">
              <button id="call-button" class="icon-button" type="button" title="Ligar" aria-label="Ligar" aria-haspopup="menu" aria-expanded="false" aria-controls="call-menu">
                <svg class="icon"><use href="#i-phone" /></svg>
              </button>
              <div id="call-menu" class="attach-menu call-menu hidden" role="menu" aria-label="Ligar">
                <button id="audio-call" type="button" role="menuitem" title="Chamada de voz" data-title="Chamada de voz"><span class="attach-icon voice"><svg class="icon"><use href="#i-phone" /></svg></span>Chamada de voz</button>
                <button id="video-call" type="button" role="menuitem" title="Chamada de vídeo" data-title="Chamada de vídeo"><span class="attach-icon cam"><svg class="icon"><use href="#i-video" /></svg></span>Chamada de vídeo</button>
                <button id="share-screen" type="button" role="menuitem" title="Transmitir tela" data-title="Transmitir tela"><span class="attach-icon screen"><svg class="icon"><use href="#i-monitor-up" /></svg></span>Transmitir a tela</button>
              </div>
            </div>
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

        <!-- Contagem regressiva até o próximo encontro (a mesma para os dois). Tocar muda a data ou desliga. -->
        <button id="countdown" class="countdown hidden" type="button" title="Mudar a contagem">
          <span class="countdown-icon" aria-hidden="true">✈️</span>
          <span class="countdown-text"><small id="countdown-label"></small><strong id="countdown-time"></strong></span>
        </button>
        <div id="net-banner" class="net-banner hidden"><span class="spinner"></span><span id="net-text">Reconectando…</span></div>

        <div id="available-call" class="available-call hidden" role="region" aria-label="Chamada disponível para reentrar">
          <span id="available-call-avatar" class="avatar call-wait-avatar" aria-hidden="true">?</span>
          <div class="available-call-copy"><strong id="available-call-text">Chamada disponível</strong><span id="available-call-note"></span><span class="available-call-deadline"><span>Tempo restante</span><time id="available-call-timer" class="available-call-timer hidden"></time></span></div>
          <button id="join-available-call" type="button" class="pill small">Voltar</button>
          <div class="call-wait-progress" aria-hidden="true"><span></span></div>
        </div>

        <!-- Chamada (estilo Discord) -->
        <div id="call-panel" class="call-panel hidden">
          <div class="call-head">
            <button id="call-minimize" class="call-minimize" type="button" title="Recolher chamada e continuar navegando" aria-label="Recolher chamada" aria-controls="call-panel"><svg class="icon" aria-hidden="true"><use href="#i-chevron-down" /></svg><span>Recolher</span></button>
          </div>
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
            <!-- A própria transmissão permanece oculta para evitar espelho infinito. -->
            <div id="my-stream" class="my-stream hidden">
              <video autoplay playsinline muted></video>
              <span class="live-badge"><i></i>VOCÊ AO VIVO</span>
              <button id="stop-stream" class="stop-stream" type="button" title="Parar a transmissão"><svg class="icon"><use href="#i-monitor-off" /></svg>Parar</button>
            </div>
          </div>
          <audio id="remote-audio" autoplay></audio>
          <div id="call-waiting" class="call-waiting hidden" aria-label="Tempo de espera da chamada">
            <div class="call-wait-copy"><strong id="call-waiting-title">Aguardando a outra pessoa</strong><span>A chamada encerra se o tempo acabar ou se você sair.</span></div>
            <div class="call-countdown"><span>Tempo para voltar</span><time id="call-waiting-timer">05:00</time></div>
            <div class="call-wait-progress" aria-hidden="true"><span></span></div>
          </div>
          <div class="call-bar">
            <div class="call-info"><span id="call-status">Preparando chamada…</span><span id="call-timer" class="call-timer"></span><span id="live-pill" class="live-pill hidden"></span></div>
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
              <button id="call-layout" class="round" type="button" title="Layout da chamada" aria-label="Trocar o layout da chamada"><svg class="icon"><use href="#i-layout" /></svg></button>
              <button id="call-pip" class="round hidden" type="button" title="Abrir miniatura flutuante" aria-label="Abrir miniatura flutuante"><svg class="icon"><use href="#i-pip" /></svg></button>
              <button id="end-call" class="round hangup" type="button" title="Sair da chamada" aria-label="Sair da chamada">
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
            <!-- Vídeo do aparelho subindo para o servidor (só para quem mandou; a outra pessoa vê "Ana está enviando um vídeo…"). -->
            <div id="watch-upload" class="watch-upload hidden">
              <svg class="icon"><use href="#i-file" /></svg>
              <p><strong id="watch-upload-name"></strong><span id="watch-upload-text"></span></p>
              <progress id="watch-upload-bar" max="1" value="0"></progress>
              <button id="watch-upload-cancel" class="watch-ghost" type="button">Cancelar</button>
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
            <button id="watch-view" class="watch-btn" type="button" title="Tela: conversa ao lado" aria-label="Trocar a tela da Watch Party"><svg class="icon"><use href="#i-layout" /></svg></button>
            <button id="watch-full" class="watch-btn" type="button" title="Tela cheia" aria-label="Tela cheia"><svg class="icon"><use id="watch-full-icon" href="#i-maximize" /></svg></button>
            <button id="watch-close" class="watch-btn danger" type="button" title="Parar para os dois" aria-label="Parar o vídeo para os dois"><svg class="icon"><use href="#i-x" /></svg></button>
          </div>
        </div>

        <div class="messages-wrap">
          <div id="messages" class="messages" aria-live="polite">
            <button id="load-more" class="load-more hidden" type="button">Carregar mensagens anteriores</button>
            <!-- Lendo um trecho antigo (pesquisa ou "ir para um dia"): as mensagens seguintes chegam ao descer. -->
            <button id="load-newer" class="load-more load-newer hidden" type="button">Carregar mensagens seguintes</button>
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
          <!-- Figurinhas: a coleção de cada um (GIFs salvos na estrela, fotos e figurinhas da conversa, imagens do aparelho). -->
          <div id="gif-panel" class="gif-panel hidden" role="dialog" aria-label="Escolher um GIF ou uma figurinha">
            <div class="gif-tabs" role="tablist">
              <button type="button" role="tab" data-gif-tab="gifs" aria-selected="true">GIFs</button>
              <button type="button" role="tab" data-gif-tab="stickers" aria-selected="false"><svg class="icon"><use href="#i-sticker" /></svg>Figurinhas</button>
            </div>
            <div id="gif-pane" class="gif-pane">
              <label class="gif-search">
                <svg class="icon"><use href="#i-search" /></svg>
                <input id="gif-search" type="search" maxlength="50" autocomplete="off" enterkeyhint="search" placeholder="Buscar GIFs" aria-label="Buscar GIFs" />
              </label>
              <div id="gif-results" class="gif-results">
                <div id="gif-grid" class="gif-grid"></div>
                <p id="gif-note" class="gif-note hidden"></p>
              </div>
              <p class="gif-credit">Powered by GIPHY · a estrela salva nas figurinhas</p>
            </div>
            <div id="sticker-pane" class="gif-pane hidden">
              <div class="sticker-bar">
                <span id="sticker-count" class="sticker-count"></span>
                <button id="sticker-edit" class="pill" type="button">Organizar</button>
              </div>
              <div class="gif-results">
                <div id="sticker-grid" class="sticker-grid"></div>
                <p id="sticker-note" class="gif-note"></p>
              </div>
            </div>
            <input id="pick-sticker" type="file" accept="image/*" hidden />
          </div>
          <div class="quick-emojis">
            <button id="emoji-button" type="button" title="Escolher emojis" aria-label="Escolher emojis" aria-haspopup="dialog" aria-expanded="false" aria-controls="emoji-panel"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 14a4.5 4.5 0 0 0 8 0"/><path d="M8.5 9h.01M15.5 9h.01" stroke-linecap="round" stroke-width="2.5"/></svg></button>
          </div>
          <div id="command-menu" class="command-menu hidden" role="listbox" aria-label="Comandos"></div>
          <!-- Fotos e arquivos: o menu escolhe entre a galeria (foto/vídeo, com câmera no celular) e qualquer arquivo. -->
          <div id="attach-menu" class="attach-menu hidden" role="menu" aria-label="Anexar">
            <button type="button" role="menuitem" data-pick="#pick-media"><span class="attach-icon media"><svg class="icon"><use href="#i-image" /></svg></span>Foto ou vídeo</button>
            <button type="button" role="menuitem" data-pick="#pick-file"><span class="attach-icon doc"><svg class="icon"><use href="#i-file" /></svg></span>Arquivo</button>
            <button type="button" role="menuitem" data-pick="#watch-button"><span class="attach-icon watch"><svg class="icon"><use href="#i-tv" /></svg></span>Batata Watch Party</button>
            <button type="button" role="menuitem" data-us-open="jogos"><span class="attach-icon games"><svg class="icon"><use href="#i-dice" /></svg></span>Joguinhos</button>
          </div>
          <input id="pick-media" type="file" accept="image/*,video/*" multiple hidden />
          <input id="pick-file" type="file" multiple hidden />
          <input id="pick-watch" type="file" accept="video/*" hidden />
          <button id="attach-button" class="attach-button" type="button" title="Enviar foto ou arquivo" aria-label="Enviar foto ou arquivo" aria-haspopup="menu" aria-expanded="false" aria-controls="attach-menu">
            <svg class="icon"><use href="#i-paperclip" /></svg>
          </button>
          <button id="gif-button" class="gif-button" type="button" title="GIFs e figurinhas" aria-label="GIFs e figurinhas" aria-haspopup="dialog" aria-expanded="false" aria-controls="gif-panel">GIF</button>
          <textarea id="message-input" rows="1" maxlength="2000" placeholder="Escreva uma mensagem…" aria-label="Mensagem"></textarea>
          <!-- Gravando um áudio. Segurando o microfone, a faixa cobre o campo e deslizar para a esquerda cancela. Sem
               segurar (como no Instagram), a faixa colorida fica em cima (parar, a onda e o tempo) e, embaixo, o apagar e
               o enviar; parado, o mesmo botão toca o áudio para ouvir antes de enviar. -->
          <div id="recorder" class="recorder hidden">
            <button id="rec-cancel" class="rec-cancel" type="button" title="Apagar o áudio" aria-label="Apagar o áudio"><svg class="icon"><use href="#i-trash" /></svg></button>
            <div class="rec-pill">
              <button id="rec-stop" class="rec-stop" type="button" title="Parar para ouvir antes de enviar" aria-label="Parar a gravação">
                <svg class="icon when-rec"><use href="#i-stop" /></svg>
                <svg class="icon when-play"><use href="#i-play" /></svg>
                <svg class="icon when-pause"><use href="#i-pause" /></svg>
              </button>
              <span class="rec-clock" role="timer" aria-label="Tempo de gravação"><i class="rec-dot"></i><span id="rec-time">0:00</span></span>
              <div id="rec-wave" class="rec-wave" aria-hidden="true"></div>
              <span id="rec-slide" class="rec-slide"><svg class="icon"><use href="#i-chevron-left" /></svg>Deslize para cancelar</span>
            </div>
          </div>
          <!-- Segurando o microfone: arrastar para cima até o cadeado trava a gravação (dá para soltar o dedo). -->
          <span id="rec-lock" class="rec-lock" aria-hidden="true"><svg class="icon"><use href="#i-lock" /></svg><svg class="icon"><use href="#i-chevron-up" /></svg></span>
          <button class="send" type="submit" aria-label="Enviar mensagem" title="Enviar">
            <svg class="icon"><use href="#i-send" /></svg>
          </button>
          <!-- Campo vazio: o microfone no lugar do enviar. Toque para gravar sem segurar, ou segure e solte para enviar. -->
          <button id="mic-button" class="mic" type="button" aria-label="Gravar áudio" title="Gravar áudio: toque para gravar, ou segure e solte para enviar">
            <svg class="icon when-mic"><use href="#i-mic" /></svg>
            <svg class="icon when-send"><use href="#i-send" /></svg>
          </button>
        </form>

        <!-- Pesquisa na conversa: no computador, uma coluna à direita (a conversa encolhe); no celular, a tela toda.
             Tocar num resultado abre a conversa naquela mensagem. -->
        <aside id="search-panel" class="search-panel hidden" aria-label="Pesquisar na conversa">
          <header class="search-head">
            <button id="search-close" class="icon-button" type="button" title="Fechar a pesquisa" aria-label="Fechar a pesquisa"><svg class="icon"><use href="#i-arrow-left" /></svg></button>
            <form id="search-form" class="search-field" role="search">
              <svg class="icon"><use href="#i-search" /></svg>
              <input id="search-input" type="search" maxlength="100" autocomplete="off" enterkeyhint="search" placeholder="Pesquisar na conversa" aria-label="Pesquisar na conversa" />
            </form>
          </header>
          <label class="search-day">
            <svg class="icon"><use href="#i-calendar" /></svg>
            <span>Ir para um dia</span>
            <input id="search-day" type="date" aria-label="Ir para um dia" />
          </label>
          <div id="search-results" class="search-results" aria-live="polite"></div>
        </aside>
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
        <div id="music-downloads" class="music-downloads hidden" role="status"><span class="spinner" aria-hidden="true"></span><span id="music-download-status"></span></div>
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
          <button class="menu-button" type="button" data-menu title="Menu" aria-label="Abrir o menu" aria-controls="sidebar" aria-expanded="false"><svg class="icon"><use href="#i-menu" /></svg><i class="menu-dot hidden" aria-hidden="true"></i></button>
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
            <!-- Visual da conversa (só neste aparelho): o tamanho da letra e o formato dos balões. -->
            <p class="picker-label">Letra da conversa</p>
            <div class="look-row" role="group" aria-label="Tamanho da letra" data-look="text">
              <button type="button" data-look-value="p">Pequena</button>
              <button type="button" data-look-value="">Normal</button>
              <button type="button" data-look-value="g">Grande</button>
              <button type="button" data-look-value="gg">Enorme</button>
            </div>
            <p class="picker-label">Balões</p>
            <div class="look-row" role="group" aria-label="Formato dos balões" data-look="bubbles">
              <button type="button" data-look-value="">Arredondados</button>
              <button type="button" data-look-value="bolha">Bolha</button>
              <button type="button" data-look-value="reto">Retos</button>
            </div>
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
            <button id="toggle-noise" class="setting-row swap" type="button" role="switch" aria-checked="true">
              <svg class="icon when-on"><use href="#i-audio-lines" /></svg>
              <svg class="icon when-off"><use href="#i-mic" /></svg>
              <span class="setting-text"><strong>Redução de ruído</strong><small id="noise-state">Nos áudios que você grava</small></span>
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

      <!-- ===================== NOSSO CANTINHO ===================== -->
      <!-- O dia de cada um, a agenda, os sonhos e metas, as cartinhas e os joguinhos. O app.js monta o conteúdo de cada parte. -->
      <section id="us-view" class="us-view" aria-labelledby="us-title">
        <header class="profile-top us-top">
          <button class="menu-button" type="button" data-menu title="Menu" aria-label="Abrir o menu" aria-controls="sidebar" aria-expanded="false"><svg class="icon"><use href="#i-menu" /></svg><i class="menu-dot hidden" aria-hidden="true"></i></button>
          <h2 id="us-title"><span class="us-title-icon" aria-hidden="true"><svg class="icon"><use id="us-title-icon" href="#i-sun" /></svg></span><span id="us-title-text">Rotina do dia</span></h2>
        </header>
        <div id="us-scroll" class="us-scroll">
          <!-- Hoje: o dia de cada um, lado a lado (no celular, um embaixo do outro). Dá para voltar aos dias anteriores. -->
          <section class="us-pane" data-pane="hoje">
            <div class="day-nav">
              <button id="day-prev" class="nav-round" type="button" title="Dia anterior" aria-label="Dia anterior"><svg class="icon"><use href="#i-chevron-left" /></svg></button>
              <div class="day-title"><strong id="day-label">Hoje</strong><small id="day-date"></small></div>
              <button id="day-next" class="nav-round" type="button" title="Próximo dia" aria-label="Próximo dia"><svg class="icon"><use href="#i-chevron-right" /></svg></button>
            </div>
            <div id="day-cards" class="day-cards" aria-live="polite"></div>
            <button id="prompts-open" class="us-card setting-row prompts-row" type="button">
              <svg class="icon"><use href="#i-bell" /></svg>
              <span class="setting-text"><strong>Lembretes da rotina</strong><small id="prompts-state">Perguntinhas na hora do café, do almoço…</small></span>
              <svg class="icon"><use href="#i-chevron-right" /></svg>
            </button>
          </section>

          <!-- Agenda dos dois, como um calendário de verdade: ao lado, o mini calendário, as agendas (a dos dois e a de
               cada um, cada uma com a sua cor; dá para esconder) e os próximos; no meio, o dia, a semana, o mês ou a lista. -->
          <section class="us-pane agenda-pane" data-pane="agenda">
            <div class="cal-layout">
              <aside class="cal-side" aria-label="Agendas">
                <button id="event-add" class="cal-create" type="button"><svg class="icon"><use href="#i-plus" /></svg>Criar</button>
                <div id="mini-cal" class="mini-cal"></div>
                <section class="cal-section" aria-labelledby="cal-legend-title">
                  <h4 id="cal-legend-title">Agendas</h4>
                  <div id="cal-legend" class="cal-legend"></div>
                </section>
                <section class="cal-section" aria-labelledby="cal-next-title">
                  <h4 id="cal-next-title">Próximos</h4>
                  <div id="cal-next-list" class="up-list"></div>
                </section>
              </aside>
              <div class="cal-main">
                <div class="cal-toolbar">
                  <button id="cal-today" class="cal-today" type="button">Hoje</button>
                  <div class="cal-arrows">
                    <button id="cal-prev" class="cal-arrow" type="button" title="Anterior" aria-label="Anterior"><svg class="icon"><use href="#i-chevron-left" /></svg></button>
                    <button id="cal-next" class="cal-arrow" type="button" title="Próximo" aria-label="Próximo"><svg class="icon"><use href="#i-chevron-right" /></svg></button>
                  </div>
                  <h3 id="cal-month" class="cal-title" aria-live="polite"></h3>
                  <div class="cal-views" role="group" aria-label="Ver por">
                    <button type="button" data-cal-view="day">Dia</button>
                    <button type="button" data-cal-view="week">Semana</button>
                    <button type="button" data-cal-view="month">Mês</button>
                    <button type="button" data-cal-view="list">Lista</button>
                  </div>
                </div>
                <div id="cal-legend-top" class="cal-legend-top" role="group" aria-label="Agendas"></div>
                <div id="cal-body" class="cal-body"></div>
              </div>
            </div>
            <button id="event-fab" class="cal-fab" type="button" title="Novo compromisso" aria-label="Novo compromisso"><svg class="icon"><use href="#i-plus" /></svg></button>
          </section>

          <!-- Sonhos e metas dos dois: dinheiro guardado (com a barra até o objetivo), passos e realizados. -->
          <section class="us-pane" data-pane="sonhos">
            <div class="pane-head">
              <p class="muted">Sonhos e metas para realizar juntinhos. Os dois guardam, marcam os passos e comemoram.</p>
              <button id="goal-add" class="pill gold small" type="button"><svg class="icon"><use href="#i-plus" /></svg>Novo</button>
            </div>
            <div id="goal-list" class="goal-list"></div>
            <h3 id="goal-done-title" class="us-subtitle hidden">Realizados</h3>
            <div id="goal-done" class="goal-list done-list"></div>
          </section>

          <!-- Cartinhas: o nosso blog. Cada um escreve para o outro; a nova aparece com o selo até ser aberta. -->
          <section class="us-pane" data-pane="cartinhas">
            <div class="pane-head">
              <p class="muted">O nosso blog de cartinhas. Escreva quando quiser; quem recebe vê o selo de nova até abrir.</p>
              <button id="letter-add" class="pill gold small" type="button"><svg class="icon"><use href="#i-pencil" /></svg>Escrever</button>
            </div>
            <div id="letter-list" class="letter-list"></div>
          </section>

          <!-- Joguinhos: escolher um jogo abre a mesinha aqui mesmo; a outra pessoa recebe o convite na conversa. -->
          <section class="us-pane" data-pane="jogos">
            <p class="muted games-lead">Escolha um jogo e a mesinha abre aqui. A outra pessoa recebe o convite na conversa, e cada um joga do seu lado, na sua vez.</p>
            <!-- O placar dos dois (todas as partidas de tabuleiro que já acabaram) e só as partidas esperando você. -->
            <section id="game-score" class="score-card hidden" aria-label="Placar"></section>
            <section id="game-live-wrap" class="hidden" aria-labelledby="game-live-title">
              <h3 id="game-live-title" class="us-subtitle">Esperando você</h3>
              <div id="game-live" class="event-list"></div>
            </section>
            <!-- Modo +18 (só neste aparelho): as cartas do casal ficam apimentadas. -->
            <button id="spicy-toggle" class="spicy-toggle" type="button" aria-pressed="false">
              <span class="spicy-flame" aria-hidden="true">🔥</span>
              <span class="spicy-text"><strong>Modo +18</strong><small>Cartas apimentadas em verdade ou desafio, quem é mais provável, isso ou aquilo e perguntinha.</small></span>
              <span class="switch" aria-hidden="true"></span>
            </button>
            <h3 class="us-subtitle">De tabuleiro</h3>
            <div class="games">
              <article class="game-tile linha4">
                <span class="game-art" aria-hidden="true"></span>
                <h3>4 em linha</h3>
                <p>Solte as peças nas colunas. Quem fizer 4 seguidas, em qualquer direção, ganha.</p>
                <button class="pill gold small" type="button" data-game-new="linha4"><svg class="icon"><use href="#i-play" /></svg>Jogar</button>
              </article>
              <article class="game-tile forca">
                <span class="game-art" aria-hidden="true"></span>
                <h3>Forca</h3>
                <p>Uma palavra e uma dica. Cada um chuta uma letra; acertou, pontua e joga de novo.</p>
                <button class="pill gold small" type="button" data-game-new="forca"><svg class="icon"><use href="#i-play" /></svg>Jogar</button>
              </article>
              <article class="game-tile velha">
                <span class="game-art" aria-hidden="true"></span>
                <h3>Jogo da velha</h3>
                <p>O clássico: três em linha. Quem começa fica com o X.</p>
                <button class="pill gold small" type="button" data-game-new="velha"><svg class="icon"><use href="#i-play" /></svg>Jogar</button>
              </article>
              <article class="game-tile dama">
                <span class="game-art" aria-hidden="true"></span>
                <h3>Dama</h3>
                <p>Captura obrigatória e dama que voa. Quem começa joga com as brancas.</p>
                <button class="pill gold small" type="button" data-game-new="dama"><svg class="icon"><use href="#i-play" /></svg>Jogar</button>
              </article>
              <article class="game-tile memoria">
                <span class="game-art" aria-hidden="true"></span>
                <h3>Jogo da memória</h3>
                <p>Oito pares escondidos. Achou um par, joga de novo; quem achar mais ganha.</p>
                <button class="pill gold small" type="button" data-game-new="memoria"><svg class="icon"><use href="#i-play" /></svg>Jogar</button>
              </article>
              <article class="game-tile stop">
                <span class="game-art" aria-hidden="true"></span>
                <h3>Stop</h3>
                <p>Uma letra e seis categorias. Preencheu tudo? Grite STOP e a rodada acaba para os dois!</p>
                <button class="pill gold small" type="button" data-game-new="stop"><svg class="icon"><use href="#i-play" /></svg>Jogar</button>
              </article>
            </div>
            <h3 class="us-subtitle">Do casal</h3>
            <div class="games">
              <article class="game-tile quem">
                <span class="game-art" aria-hidden="true"></span>
                <h3>Quem é mais provável?</h3>
                <p>Cada um vota em quem combina mais. Os votos aparecem quando os dois votarem.</p>
                <button class="pill gold small" type="button" data-game-new="quem"><svg class="icon"><use href="#i-play" /></svg>Jogar</button>
              </article>
              <article class="game-tile vd">
                <span class="game-art" aria-hidden="true"></span>
                <h3>Verdade ou desafio</h3>
                <p data-game-hint="vd">A outra pessoa escolhe: verdade ou desafio. Perguntas e desafios fofinhos.</p>
                <button class="pill gold small" type="button" data-game-new="vd"><svg class="icon"><use href="#i-play" /></svg>Desafiar</button>
              </article>
              <article class="game-tile isso">
                <span class="game-art" aria-hidden="true"></span>
                <h3>Isso ou aquilo</h3>
                <p>Duas opções. Cada um escolhe sem ver a escolha do outro. Será que combinam?</p>
                <button class="pill gold small" type="button" data-game-new="isso"><svg class="icon"><use href="#i-play" /></svg>Jogar</button>
              </article>
              <article class="game-tile pergunta">
                <span class="game-art" aria-hidden="true"></span>
                <h3>Perguntinha</h3>
                <p>Uma pergunta para os dois. As respostas só aparecem quando os dois responderem.</p>
                <button class="pill gold small" type="button" data-game-new="pergunta"><svg class="icon"><use href="#i-play" /></svg>Jogar</button>
              </article>
            </div>
          </section>
        </div>
      </section>

      <!-- Fundo escuro da gaveta do menu (celular): tocar fecha. A conversa e o perfil também ficam no menu. -->
      <div id="menu-backdrop" class="menu-backdrop" aria-hidden="true"></div>
    </main>

    <!-- ===================== JANELAS ===================== -->
    <div id="incoming" class="modal incoming hidden" role="dialog" aria-modal="true" aria-labelledby="incoming-title">
      <div class="modal-card incoming-card">
        <div class="incoming-avatar"><div class="ring"></div><div class="ring r2"></div><div class="ring r3"></div><div id="incoming-face" class="avatar big">?</div></div>
        <p class="eyebrow">Chamada recebida</p>
        <h3 id="incoming-title">Alguém está ligando</h3>
        <p id="incoming-kind" class="muted">Chamada de voz</p>
        <div class="modal-actions">
          <button id="decline-call" class="pill decline" type="button"><svg class="icon"><use href="#i-hangup" /></svg><span id="decline-label">Recusar</span></button>
          <button id="accept-call" class="pill accept" type="button"><svg class="icon"><use href="#i-phone" /></svg><span id="accept-label">Atender</span></button>
        </div>
      </div>
    </div>

    <!-- Adicionar pessoa: o link de convite (vale uma vez, por 7 dias) e, para quem recebeu um, colar o link ou o código. -->
    <div id="add-person" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="add-title">
      <div class="modal-card sheet-card add-card">
        <header class="sheet-head">
          <span class="sheet-icon" aria-hidden="true"><svg class="icon"><use href="#i-user-plus" /></svg></span>
          <h3 id="add-title">Adicionar pessoa</h3>
          <button id="add-close" class="peer-close" type="button" title="Fechar" aria-label="Fechar"><svg class="icon"><use href="#i-x" /></svg></button>
        </header>
        <p class="muted add-lead">Mande este link para quem você quer adicionar. Quem abrir cria a conta (ou entra na dela) e vocês ganham uma conversa só de vocês.</p>
        <div class="invite-row">
          <input id="invite-link" class="field-input" type="text" readonly aria-label="Link do convite" placeholder="Criando o link…" />
          <button id="invite-copy" class="pill small" type="button"><svg class="icon"><use href="#i-copy" /></svg>Copiar</button>
        </div>
        <p id="invite-state" class="hint invite-state"></p>
        <button id="invite-share" class="pill ghost invite-share" type="button"><svg class="icon"><use href="#i-share" /></svg>Compartilhar o link</button>
        <form id="invite-form" class="invite-form">
          <label for="invite-code">Recebeu um convite?</label>
          <div class="invite-row">
            <input id="invite-code" class="field-input" type="text" autocomplete="off" placeholder="Cole o link ou o código" />
            <button class="pill small" type="submit">Entrar</button>
          </div>
        </form>
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
          <button type="button" role="radio" data-quality="1440p"><strong>Ultra</strong><small>1440p · tela grande e texto miúdo (internet boa)</small></button>
          <button type="button" role="radio" data-quality="1440p60"><strong>Ultra fluida</strong><small>1440p a 60 fps · jogos (internet muito boa)</small></button>
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

    <!-- Nosso cantinho: o formulário de cada coisa (refeição, compromisso, sonho, cartinha…), montado pelo app.js. -->
    <div id="us-sheet" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <form id="sheet-form" class="modal-card sheet-card" novalidate>
        <header class="sheet-head">
          <span id="sheet-icon" class="sheet-icon" aria-hidden="true"><svg class="icon"><use href="#i-sparkles" /></svg></span>
          <h3 id="sheet-title"></h3>
          <button class="peer-close" type="button" data-sheet-close title="Fechar" aria-label="Fechar"><svg class="icon"><use href="#i-x" /></svg></button>
        </header>
        <div id="sheet-body" class="sheet-body"></div>
        <div class="sheet-actions">
          <button id="sheet-delete" class="text-button hidden" type="button">Apagar</button>
          <button id="sheet-cancel" class="pill ghost" type="button" data-sheet-close>Cancelar</button>
          <button id="sheet-submit" class="pill gold" type="submit">Salvar</button>
        </div>
      </form>
    </div>

    <!-- Detalhes de um compromisso (tocar nele na agenda). No celular, sobe de baixo. -->
    <div id="event-pop" class="event-pop hidden" role="dialog" aria-labelledby="pop-title">
      <div class="pop-tools">
        <button type="button" data-pop="edit" title="Editar" aria-label="Editar"><svg class="icon"><use href="#i-pencil" /></svg></button>
        <button type="button" data-pop="delete" title="Apagar" aria-label="Apagar"><svg class="icon"><use href="#i-trash" /></svg></button>
        <button type="button" data-pop="close" title="Fechar" aria-label="Fechar"><svg class="icon"><use href="#i-x" /></svg></button>
      </div>
      <div class="pop-head">
        <span class="pop-color" aria-hidden="true"><svg class="icon"><use id="pop-icon" href="#i-calendar" /></svg></span>
        <div><h3 id="pop-title"></h3><p id="pop-when"></p></div>
      </div>
      <ul id="pop-details" class="pop-details"></ul>
    </div>

    <!-- Cartinha aberta, no papel e na letra que quem escreveu escolheu, com os áudios e as fotos. Antes, o envelope chega
         e abre (fx.letter). -->
    <div id="letter-view" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="letter-title">
      <div id="envelope" class="envelope hidden" aria-hidden="true">
        <span class="env-back"></span>
        <span class="env-sheet"></span>
        <span class="env-front"></span>
        <span class="env-flap"></span>
        <span class="env-seal"><svg class="icon"><use href="#i-heart" /></svg></span>
      </div>
      <article id="letter-paper" class="letter-paper">
        <button id="letter-close" class="peer-close" type="button" title="Fechar" aria-label="Fechar"><svg class="icon"><use href="#i-x" /></svg></button>
        <p id="letter-to" class="letter-to"></p>
        <h3 id="letter-title"></h3>
        <div id="letter-audios" class="letter-audios"></div>
        <!-- O papel da cartinha: o texto e, por cima, as imagens e figurinhas soltas (decor), onde quem escreveu deixou. -->
        <div id="letter-page" class="letter-page-view">
          <div id="letter-body" class="letter-body"></div>
          <div id="letter-decor" class="letter-decor"></div>
        </div>
        <div id="letter-photos" class="letter-photos"></div>
        <p id="letter-sign" class="letter-sign"></p>
        <p id="letter-state" class="letter-state"></p>
        <div id="letter-tools" class="letter-tools hidden">
          <button id="letter-edit" class="pill ghost small" type="button"><svg class="icon"><use href="#i-pencil" /></svg>Editar</button>
          <button id="letter-delete" class="text-button" type="button">Apagar</button>
        </div>
      </article>
    </div>

    <!-- Mesinha de jogo (velha, dama, memória e stop): o tabuleiro de uma partida da conversa, ao vivo para os dois. -->
    <div id="game-table" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="table-title">
      <div class="modal-card table-card">
        <header class="sheet-head">
          <span id="table-icon" class="sheet-icon" aria-hidden="true"><svg class="icon"><use href="#i-dice" /></svg></span>
          <div class="table-heading"><h3 id="table-title"></h3><p id="table-status" class="table-status" aria-live="polite"></p></div>
          <button id="table-close" class="peer-close" type="button" title="Fechar (a partida continua na conversa)" aria-label="Fechar"><svg class="icon"><use href="#i-x" /></svg></button>
        </header>
        <div id="table-players" class="table-players"></div>
        <div id="table-board" class="table-board"></div>
        <div id="table-actions" class="table-actions"></div>
      </div>
    </div>

    <!-- Lembrete com o site na tela ("O que você almoçou?"): responde aqui mesmo. -->
    <div id="nudge" class="nudge hidden" role="dialog" aria-labelledby="nudge-title" aria-describedby="nudge-text">
      <button id="nudge-close" class="peer-close" type="button" title="Agora não" aria-label="Agora não"><svg class="icon"><use href="#i-x" /></svg></button>
      <span class="nudge-head"><span class="sheet-icon" aria-hidden="true"><svg class="icon"><use id="nudge-icon" href="#i-bell" /></svg></span><strong id="nudge-title"></strong></span>
      <p id="nudge-text"></p>
      <form id="nudge-form" class="nudge-form">
        <input id="nudge-input" autocomplete="off" maxlength="300" enterkeyhint="send" aria-label="Sua resposta" />
        <button class="pill gold small" type="submit">Responder</button>
      </form>
      <div id="nudge-actions" class="nudge-actions">
        <button id="nudge-done" class="pill gold small" type="button"><svg class="icon"><use href="#i-check" /></svg>Fiz tudo</button>
        <button id="nudge-open" class="pill ghost small" type="button">Abrir</button>
      </div>
    </div>

    <script src="vendor/gsap.min.js"></script>
    <script type="importmap">
      { "imports": { "./fx.js": "./<?= asset('fx.js') ?>", "./sound.js": "./<?= asset('sound.js') ?>", "./realtime.js": "./<?= asset('realtime.js') ?>", "./music.js": "./<?= asset('music.js') ?>", "./watch.js": "./<?= asset('watch.js') ?>" } }
    </script>
    <script type="module" src="<?= asset('app.js') ?>"></script>
  </body>
</html>
