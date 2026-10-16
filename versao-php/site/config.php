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
];
