"""Uma faixa por processo: busca no Spotify e download normal pelo spotDL."""
import asyncio
import json
import os
import re
from pathlib import Path
import sqlite3
import sys
import tempfile

from spotdl import Spotdl
from spotdl.types.song import Song
from spotdl.utils.config import DEFAULT_CONFIG
from yt_dlp import YoutubeDL
from server import clean_query, youtube_id


def youtube_track(root, query, result, video):
    # O mesmo motor de áudio usado pelo spotDL, preservando a versão exata do vídeo.
    with sqlite3.connect(root / "library.sqlite") as db:
        tracks = [json.loads(row[0]) for row in db.execute("SELECT metadata FROM tracks")]
    existing = next((track for track in tracks if (track["id"] == "yt_" + video or track.get("youtube_id") == video)
        and (root / f"{track['id']}.mp3").is_file()), None)
    if existing:
        result.write_text(json.dumps(existing))
        return
    with tempfile.TemporaryDirectory(prefix="download-", dir=root) as temporary:
        options = {"format": "bestaudio/best", "outtmpl": str(Path(temporary) / "audio.%(ext)s"),
            "noplaylist": True, "quiet": True, "noprogress": True, "retries": 1, "socket_timeout": 15,
            "js_runtimes": {"node": {}},
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}]}
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(query, download=False)
            if not info or info.get("id") != video or info.get("_type", "video") != "video":
                raise ValueError("Envie o link de um vídeo individual do YouTube.")
            duration = info.get("duration") or 0
            if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming") or not 0 < duration <= 1200:
                raise ValueError("Escolha um vídeo gravado com até 20 minutos.")
            print(f"Baixando áudio do YouTube: {video} ({duration}s)", flush=True)
            downloader.process_ie_result(info, download=True)
        downloaded = Path(temporary) / "audio.mp3"
        if not downloaded.is_file() or downloaded.stat().st_size < 512:
            raise RuntimeError("O provedor de áudio não disponibilizou esse vídeo.")
        track_id = "yt_" + video
        os.replace(downloaded, root / f"{track_id}.mp3")
        cover = f"https://i.ytimg.com/vi/{video}/hqdefault.jpg"
        result.write_text(json.dumps({"id": track_id, "youtube_id": video, "title": info.get("track") or info.get("title") or "YouTube",
            "artist": info.get("artist") or info.get("uploader") or "", "duration": duration, "thumb": cover, "cover": cover,
            "origin": {"source": "youtube", "type": "video", "id": video, "url": query}}))

root, query, result = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
query = clean_query(query)
video = youtube_id(query)
if video:
    youtube_track(root, query, result, video)
    sys.exit(0)
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)
with tempfile.TemporaryDirectory(prefix="download-", dir=root) as temporary:
    client = Spotdl(client_id=os.environ.get("SPOTIFY_CLIENT_ID", DEFAULT_CONFIG["client_id"]),
        client_secret=os.environ.get("SPOTIFY_CLIENT_SECRET", DEFAULT_CONFIG["client_secret"]),
        headless=True, loop=loop, downloader_settings={"output": str(Path(temporary) / "audio.mp3"),
            "format": "mp3", "bitrate": "192k", "threads": 1, "lyrics_providers": [], "overwrite": "skip",
            "audio_providers": ["youtube"], "yt_dlp_args": "--js-runtimes node --no-progress", "print_errors": True, "ffmpeg_args": "-threads 1"})
    print("Identificando a faixa no Spotify", flush=True)
    # Os métodos explícitos não interpretam nomes enviados pelo usuário como arquivos locais.
    song = Song.from_url(query) if query.startswith("https://open.spotify.com/track/") else Song.from_search_term(query)
    if not re.fullmatch(r"[A-Za-z0-9]{22}", song.song_id):
        raise ValueError("Identificador de música inválido.")
    if not 0 < song.duration <= 1200:
        raise ValueError("Escolha uma música com até 20 minutos.")
    with sqlite3.connect(root / "library.sqlite") as db:
        rows = db.execute("SELECT metadata FROM tracks").fetchall()
    existing = next((json.loads(row[0]) for row in rows if json.loads(row[0])["id"] == song.song_id
        or (song.isrc and json.loads(row[0]).get("isrc") == song.isrc)), None)
    if existing and (root / f"{existing['id']}.mp3").is_file():
        result.write_text(json.dumps(existing))
    else:
        print(f"Baixando áudio: {song.song_id} ({song.duration}s)", flush=True)
        downloaded_song, downloaded = client.download(song)
        if downloaded is None or not Path(downloaded).is_file() or Path(downloaded).stat().st_size < 512:
            raise RuntimeError("O provedor de áudio não disponibilizou essa música.")
        target = root / f"{song.song_id}.mp3"
        os.replace(downloaded, target)
        result.write_text(json.dumps({"id": song.song_id, "title": song.name, "artist": ", ".join(song.artists),
            "duration": song.duration, "thumb": song.cover_url, "cover": song.cover_url, "isrc": song.isrc,
            "youtube_id": youtube_id(downloaded_song.download_url or ""),
            "origin": {"source": "spotify", "type": "track", "id": song.song_id, "url": "https://open.spotify.com/track/" + song.song_id}}))
loop.close()
