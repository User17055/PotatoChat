<?php
// O download roda na VPS; o PHP só agenda e acompanha os pedidos, sem bloquear o chat.
function local_music_api(string $path, array $body): ?array
{
    $base = rtrim(str(config()['music_local_url']), '/');
    $key = str(config()['music_local_key']);
    if ($base === '' || $key === '') return null;
    [$status, $raw] = http_post($base . '/v1/' . $path, ['Content-Type: application/json', 'Authorization: Bearer ' . $key], encode($body), 2);
    $data = json_decode($raw, true);
    return $status === 200 && is_array($data) ? $data : null;
}

function local_music_track($raw): ?array
{
    if (!is_array($raw) || !preg_match('/^(?:[A-Za-z0-9]{22}|yt_[A-Za-z0-9_-]{11})$/', str($raw['id'] ?? ''))) return null;
    $url = str($raw['url'] ?? '');
    $base = rtrim(str(config()['music_local_url']), '/');
    if ($base === '' || !str_starts_with($url, $base . '/media/' . $raw['id'] . '.mp3?')) return null;
    $youtube = str_starts_with($raw['id'], 'yt_');
    return ['source' => 'local', 'type' => 'track', 'id' => $raw['id'], 'url' => $url,
        'title' => text_slice(str($raw['title'] ?? 'Música'), 200), 'artist' => text_slice(str($raw['artist'] ?? ''), 200),
        'duration' => max(0, min(1200, (float) ($raw['duration'] ?? 0))),
        'thumb' => https_url($raw['thumb'] ?? null), 'cover' => https_url($raw['cover'] ?? null),
        'origin' => ['source' => $youtube ? 'youtube' : 'spotify', 'type' => $youtube ? 'video' : 'track', 'id' => $youtube ? substr($raw['id'], 3) : $raw['id']]];
}

function local_music_request(array $me, string $query): array
{
    if ($query === '') return ['ok' => false, 'error' => 'Use /playl e o nome ou o link de uma música.'];
    if (str(config()['music_local_url']) === '') return ['ok' => false, 'error' => 'A biblioteca de músicas ainda não está disponível.'];
    $room = $me['room']['id'];
    $state = music_state($room, true);
    if (count($state['pending']) >= 5 || count($state['queue']) + count($state['pending']) >= MUSIC_QUEUE_MAX)
        return ['ok' => false, 'error' => 'Aguarde as músicas que já estão sendo preparadas.'];
    $job = local_music_api('jobs', ['query' => $query]);
    if (!$job) return ['ok' => false, 'error' => 'A biblioteca não respondeu. Tente novamente em instantes.'];
    if (($job['status'] ?? '') === 'ready') {
        $track = local_music_track($job['track'] ?? null);
        return $track ? music_act($me, ['op' => 'play'], $track) : ['ok' => false, 'error' => 'O arquivo da música não está disponível.'];
    }
    if (!preg_match('/^[a-f0-9]{32}$/', str($job['id'] ?? ''))) return ['ok' => false, 'error' => 'Não foi possível preparar essa música.'];
    $id = uuid();
    $request = ['id' => $id, 'job' => $job['id'], 'query' => $query, 'room' => $room, 'by' => $me['name'], 'createdAt' => now_ms()];
    query('INSERT INTO ' . t('settings') . ' (name, value) VALUES (?, ?)', ['local-music:' . $id, encode($request)]);
    $state['pending'][] = ['id' => $id, 'title' => $query, 'by' => $me['name']];
    save_music($room, $state);
    $public = music_public($state);
    emit('music', ['state' => $public, 'action' => ['op' => 'preparing', 'by' => $me['name']], 'room' => $room], 'all', null, null, $room);
    return ['ok' => true, 'pending' => true, 'state' => $public];
}

function local_music_sweep(): void
{
    if (str(config()['music_local_url']) === '') return;
    $last = (int) query('SELECT value FROM ' . t('settings') . ' WHERE name=?', ['local-music-poll'])->fetchColumn();
    if (now_ms() - $last < 1000) return;
    $rows = query('SELECT name, value FROM ' . t('settings') . " WHERE name LIKE 'local-music:%' LIMIT 30")->fetchAll();
    if (!$rows) return;
    query('INSERT INTO ' . t('settings') . ' (name,value) VALUES(?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)', ['local-music-poll', (string) now_ms()]);
    $requests = array_filter(array_map(fn($row) => json_decode($row['value'], true), $rows), 'is_array');
    $result = local_music_api('status', ['ids' => array_values(array_unique(array_column($requests, 'job')))]);
    if (!$result) {
        // Uma falha na VPS não deve atrasar todas as consultas do chat.
        query('UPDATE ' . t('settings') . ' SET value=? WHERE name=?', [(string) (now_ms() + 29000), 'local-music-poll']);
        return;
    }
    foreach ($requests as $request) {
        $state = music_state($request['room'], true);
        $present = array_filter($state['pending'], fn($item) => $item['id'] === $request['id']);
        $job = $result['jobs'][$request['job']] ?? ['status' => 'pending'];
        $expired = now_ms() - $request['createdAt'] > 1200000;
        if ($present && !$expired && ($job['status'] ?? '') === 'pending') continue;
        query('DELETE FROM ' . t('settings') . ' WHERE name=?', ['local-music:' . $request['id']]);
        if (!$present || !find_room($request['room'])) continue; // /stop cancela a entrada na fila.
        $state['pending'] = array_values(array_filter($state['pending'], fn($item) => $item['id'] !== $request['id']));
        save_music($request['room'], $state);
        $track = ($job['status'] ?? '') === 'ready' ? local_music_track($job['track'] ?? null) : null;
        $added = $track ? music_act(['name' => $request['by'], 'room' => ['id' => $request['room']]], ['op' => 'play'], $track) : null;
        if (!$added || !$added['ok']) {
            $message = text_slice(str($added['error'] ?? $job['error'] ?? 'Não foi possível preparar essa música. Envie /playl novamente.'), 200);
            emit('music', ['state' => music_public($state), 'action' => ['op' => 'local-error', 'by' => $request['by'], 'message' => $message], 'room' => $request['room']], 'all', null, null, $request['room']);
        }
    }
}
