<?php
// Configurações do Potato Chat. Preencha os dados do banco antes de enviar por FTP.
// Nomes, senhas e fotos ficam no banco: as duas primeiras pessoas que entrarem escolhem nome e senha.

return [
    // Banco MySQL criado no painel da hospedagem (cPanel, hPanel…). As tabelas são criadas sozinhas.
    'db' => [
        'host' => 'potato.mysql.dbaas.com.br',
        'port' => 3306,
        'name' => 'potato',
        'user' => 'potato',
        'pass' => 'Japonego123@',
        // Prefixo das tabelas: permite usar um banco que já tem outras coisas.
        'prefix' => 'potato_',
    ],

    // Chave que assina as sessões. Vazio = gerada automaticamente e guardada no banco.
    'token_secret' => '',

    // Segundos que cada consulta espera por novidades (long polling).
    // 0 = consultas curtas a cada 1,5 s, para hospedagens que derrubam requisições demoradas.
    'poll_wait' => 20,

    // Chave da busca de GIFs do GIPHY (grátis): https://developers.giphy.com → Create an App → API.
    // Vazio = o botão GIF continua no chat, mas avisa que a busca ainda não foi ativada.
    'giphy_key' => 'wHE7eEmagymnCaFOApKXmlHSg93Kp5tE',

    // Bot de música (/play): chave da YouTube Data API, opcional. Vazio = a busca pelo nome funciona assim mesmo
    // (lendo a página de resultados do YouTube); com a chave, fica no jeito oficial. Veja o LEIA-ME.
    'youtube_key' => '',
];
