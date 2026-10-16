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
      <symbol id="i-volume" viewBox="0 0 24 24"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></symbol>
      <symbol id="i-volume-off" viewBox="0 0 24 24"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></symbol>
      <symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></symbol>
      <symbol id="i-bell-off" viewBox="0 0 24 24"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></symbol>
      <symbol id="i-logout" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></symbol>
      <symbol id="i-arrow-right" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></symbol>
      <symbol id="i-send" viewBox="0 0 24 24"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></symbol>
      <symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></symbol>
      <symbol id="i-chevron-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
      <symbol id="i-reply" viewBox="0 0 24 24"><path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></symbol>
      <symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></symbol>
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
    <main id="chat-view" class="app-shell hidden">
      <aside class="sidebar">
        <div>
          <div class="brand-row"><svg class="potato-mini" viewBox="0 0 142 100" aria-hidden="true"><use href="#potato" /></svg><strong>Potato</strong></div>
          <div class="room-label">No nosso chat</div>
          <div id="people" class="people"></div>
        </div>
        <div class="sidebar-bottom">
          <button id="toggle-notify" class="side-option swap is-off" type="button">
            <svg class="icon when-on"><use href="#i-bell" /></svg>
            <svg class="icon when-off"><use href="#i-bell-off" /></svg>
            <span><strong>Notificações</strong><small id="notify-state">Desativadas</small></span>
          </button>
          <button id="toggle-sound-side" class="side-option swap" type="button">
            <svg class="icon when-on"><use href="#i-volume" /></svg>
            <svg class="icon when-off"><use href="#i-volume-off" /></svg>
            <span><strong>Sons</strong><small class="sound-state">Ligados</small></span>
          </button>
          <button class="side-option logout" type="button" data-logout>
            <svg class="icon"><use href="#i-logout" /></svg>
            <span><strong>Sair</strong><small>Encerrar esta sessão</small></span>
          </button>
        </div>
      </aside>

      <section class="conversation">
        <header class="topbar">
          <div class="peer">
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
            <button id="me-button" class="icon-button compact-only me-button" type="button" title="Sua foto" aria-label="Sua foto de perfil" data-profile>
              <span id="me-avatar" class="avatar" aria-hidden="true">?</span>
            </button>
            <button id="toggle-sound" class="icon-button compact-only swap" type="button" title="Sons" aria-label="Ligar ou desligar sons">
              <svg class="icon when-on"><use href="#i-volume" /></svg>
              <svg class="icon when-off"><use href="#i-volume-off" /></svg>
            </button>
            <button class="icon-button compact-only" type="button" title="Sair" aria-label="Sair" data-logout>
              <svg class="icon"><use href="#i-logout" /></svg>
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
          </div>
          <audio id="remote-audio" autoplay></audio>
          <div class="call-bar">
            <div class="call-info"><span class="call-dot"></span><span id="call-status">Preparando chamada…</span><span id="call-timer" class="call-timer"></span></div>
            <div class="call-buttons">
              <button id="toggle-mic" class="round swap" type="button" title="Silenciar microfone" aria-label="Microfone">
                <svg class="icon when-on"><use href="#i-mic" /></svg>
                <svg class="icon when-off"><use href="#i-mic-off" /></svg>
              </button>
              <button id="toggle-cam" class="round swap is-off" type="button" title="Ligar câmera" aria-label="Câmera">
                <svg class="icon when-on"><use href="#i-video" /></svg>
                <svg class="icon when-off"><use href="#i-video-off" /></svg>
              </button>
              <div class="live-wrap">
                <button id="toggle-live" class="round swap is-off" type="button" title="Transmitir tela" aria-label="Transmitir tela">
                  <svg class="icon when-on"><use href="#i-monitor-off" /></svg>
                  <svg class="icon when-off"><use href="#i-monitor-up" /></svg>
                </button>
                <div id="quality-menu" class="quality-menu hidden" role="menu">
                  <p>Qualidade da transmissão</p>
                  <button type="button" data-quality="720p" role="menuitem">720p · 30 fps<small>Leve, para internet mais fraca</small></button>
                  <button type="button" data-quality="1080p" role="menuitem">1080p · 30 fps<small>Nítido para textos e telas</small></button>
                  <button type="button" data-quality="1080p60" role="menuitem">1080p · 60 fps<small>Suave para jogos e vídeos</small></button>
                </div>
              </div>
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

        <div class="messages-wrap">
          <div id="messages" class="messages" aria-live="polite">
            <button id="load-more" class="load-more hidden" type="button">Carregar mensagens anteriores</button>
          </div>
          <div id="day-float" class="day day-float hidden" aria-hidden="true"></div>
          <button id="jump" class="jump hidden" type="button" aria-label="Ir para a última mensagem">
            <svg class="icon"><use href="#i-chevron-down" /></svg>
            <span id="jump-count" class="jump-count hidden">0</span>
          </button>
        </div>

        <div id="typing" class="typing" aria-live="polite">
          <div class="typing-bubble"><i></i><i></i><i></i></div><span id="typing-text"></span>
        </div>

        <div id="reply-bar" class="reply-bar hidden">
          <svg class="icon reply-icon"><use href="#i-reply" /></svg>
          <div><strong id="reply-name"></strong><p id="reply-text"></p></div>
          <button id="reply-cancel" type="button" aria-label="Cancelar resposta" title="Cancelar resposta">
            <svg class="icon"><use href="#i-x" /></svg>
          </button>
        </div>

        <form id="message-form" class="composer">
          <div class="quick-emojis" role="group" aria-label="Enviar emoji rápido">
            <button type="button" data-emoji="❤️" title="Enviar ❤️">❤️</button><button type="button" data-emoji="😂" title="Enviar 😂">😂</button><button type="button" data-emoji="🥔" title="Enviar 🥔">🥔</button>
          </div>
          <textarea id="message-input" rows="1" maxlength="2000" placeholder="Escreva uma mensagem…" aria-label="Mensagem"></textarea>
          <button class="send" type="submit" aria-label="Enviar mensagem" title="Enviar">
            <svg class="icon"><use href="#i-send" /></svg>
          </button>
        </form>
      </section>
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

    <div id="profile" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="profile-name">
      <div class="modal-card profile-card">
        <button id="profile-photo" class="profile-photo" type="button" aria-label="Escolher foto" title="Escolher foto">
          <span id="profile-face" class="avatar big">?</span>
          <span class="photo-badge"><svg class="icon"><use href="#i-camera" /></svg></span>
        </button>
        <h3 id="profile-name">Você</h3>
        <p class="muted">Sua foto aparece para a outra pessoa na conversa e nas chamadas.</p>
        <input id="photo-input" type="file" accept="image/*" hidden />
        <div class="modal-actions">
          <button id="profile-close" class="pill ghost" type="button">Fechar</button>
          <button id="photo-pick" class="pill gold" type="button"><svg class="icon"><use href="#i-camera" /></svg>Trocar foto</button>
        </div>
        <button id="photo-remove" class="text-button hidden" type="button">Remover foto</button>
      </div>
    </div>

    <script src="vendor/gsap.min.js"></script>
    <script type="importmap">
      { "imports": { "./fx.js": "./<?= asset('fx.js') ?>", "./sound.js": "./<?= asset('sound.js') ?>", "./realtime.js": "./<?= asset('realtime.js') ?>" } }
    </script>
    <script type="module" src="<?= asset('app.js') ?>"></script>
  </body>
</html>
