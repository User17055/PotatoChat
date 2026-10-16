<?php
// Configurações do Potato Chat. Preencha antes de enviar por FTP e troque a senha!

return [
    // Senha para entrar no chat.
    'password' => 'troque-esta-senha',

    // Banco MySQL criado no painel da hospedagem (cPanel, hPanel…). As tabelas são criadas sozinhas.
    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'name' => 'nome_do_banco',
        'user' => 'usuario_do_banco',
        'pass' => 'senha_do_banco',
        // Prefixo das tabelas: permite usar um banco que já tem outras coisas.
        'prefix' => 'potato_',
    ],

    // Os dois nomes que podem entrar, ex.: ['André', 'Batata'].
    // Vazio = os dois primeiros que entrarem ficam registrados no banco.
    'users' => [],

    // Chave que assina as sessões. Vazio = gerada automaticamente e guardada no banco.
    'token_secret' => '',

    // Segundos que cada consulta espera por novidades (long polling).
    // 0 = consultas curtas a cada 1,5 s, para hospedagens que derrubam requisições demoradas.
    'poll_wait' => 20,
];
