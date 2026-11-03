<?php
// Copie para turn.config.php (ignorado pelo Git), ao lado do config.php da hospedagem.
return [
    'turn_urls' => [
        'turn:turn.seudominio.com:3478?transport=udp',
        'turn:turn.seudominio.com:3478?transport=tcp',
        'turns:turn.seudominio.com:5349?transport=tcp',
    ],
    'turn_secret' => '', // Mesmo segredo do coturn (use-auth-secret), guardado só no servidor.
    'turn_ttl' => 3600,
    'turn_only' => false, // true força relay para diagnóstico.
];
