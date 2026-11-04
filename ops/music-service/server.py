"""Biblioteca spotDL: trabalhos assíncronos, cache por faixa e áudio com Range."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import unicodedata
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


def run_download(args, log):
    with subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT,
                          start_new_session=os.name == "posix") as process:
        try:
            process.wait(timeout=240)
        except subprocess.TimeoutExpired:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
            process.wait()
            raise
        return process.returncode


def clean_query(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 300 or any(ord(c) < 32 for c in value):
        raise ValueError("Informe o nome ou o link de uma música.")
    value = unicodedata.normalize("NFKC", value).strip()
    match = re.fullmatch(r"(?:https?://open\.spotify\.com/(?:intl-[a-z-]+/)?track/|spotify:track:)([A-Za-z0-9]{22})(?:\?[^\s]*)?", value)
    if match:
        return "https://open.spotify.com/track/" + match[1]
    if "://" in value or value.startswith(("spotify:", "-")):
        raise ValueError("Use o nome ou o link de uma faixa do Spotify; envie uma música por vez.")
    return " ".join(value.split())


class Library:
    def __init__(self, directory, secret, public_url):
        self.root = Path(directory)
        self.root.mkdir(parents=True, exist_ok=True)
        self.secret = secret
        self.public_url = public_url.rstrip("/")
        self.database = self.root / "library.sqlite"
        self.lock = threading.Lock()
        with self.db() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS tracks(id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS aliases(query TEXT PRIMARY KEY, track TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, query TEXT NOT NULL, status TEXT NOT NULL,
                    created REAL NOT NULL, track TEXT, error TEXT);
                UPDATE jobs SET status='queued' WHERE status='working';
            """)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.database, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def track(self, track_id):
        with self.db() as db:
            row = db.execute("SELECT metadata FROM tracks WHERE id=?", (track_id,)).fetchone()
        if not row or not (self.root / f"{track_id}.mp3").is_file():
            return None
        return json.loads(row[0])

    def public_track(self, track):
        expires = int(time.time()) + 7 * 86400
        signature = self.sign(track["id"], expires)
        return {**track, "source": "local", "type": "track", "url": f"{self.public_url}/media/{track['id']}.mp3?expires={expires}&sig={signature}"}

    def sign(self, track_id, expires):
        return hmac.new(self.secret.encode(), f"media:{track_id}:{expires}".encode(), hashlib.sha256).hexdigest()

    def create(self, query):
        query = clean_query(query)
        key = query.casefold()
        with self.lock, self.db() as db:
            alias = db.execute("SELECT track FROM aliases WHERE query=?", (key,)).fetchone()
            track = self.track(alias[0]) if alias else None
            if track:
                return {"status": "ready", "cached": True, "track": self.public_track(track)}
            row = db.execute("SELECT * FROM jobs WHERE query=? AND status IN ('queued','working')", (query,)).fetchone()
            if row:
                return {"id": row["id"], "status": "pending"}
            if db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','working')").fetchone()[0] >= 12:
                raise ValueError("Há muitas músicas sendo preparadas. Aguarde um pouco.")
            job_id = uuid.uuid4().hex
            db.execute("INSERT INTO jobs(id,query,status,created) VALUES(?,?,'queued',?)", (job_id, query, time.time()))
            return {"id": job_id, "status": "pending"}

    def statuses(self, ids):
        results = {}
        with self.db() as db:
            for job_id in ids[:30]:
                row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
                if not row:
                    results[job_id] = {"status": "error", "error": "O pedido expirou. Envie /playl novamente."}
                elif row["status"] == "ready":
                    track = self.track(row["track"])
                    results[job_id] = {"status": "ready", "track": self.public_track(track)} if track else {"status": "error", "error": "O arquivo não está disponível. Tente novamente."}
                elif row["status"] == "error":
                    results[job_id] = {"status": "error", "error": row["error"]}
                else:
                    results[job_id] = {"status": "pending"}
        return results

    def process_one(self):
        with self.db() as db:
            row = db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if not row:
                return False
            db.execute("UPDATE jobs SET status='working' WHERE id=?", (row["id"],))
        error = None
        result_file = self.root / f"result-{row['id']}.json"
        log_file = self.root / f"download-{row['id']}.log"
        try:
            used = sum(p.stat().st_size for p in self.root.glob("*.mp3"))
            if used > int(os.environ.get("MUSIC_MAX_BYTES", 2 * 1024**3)):
                raise ValueError("A biblioteca está cheia. Libere espaço para baixar novas músicas.")
            if time.time() - row["created"] > 1200:
                raise ValueError("O pedido demorou demais. Envie /playl novamente.")
            with log_file.open("w") as log:
                returncode = run_download([sys.executable, str(Path(__file__).with_name("download.py")),
                    str(self.root), row["query"], str(result_file)], log)
            if returncode or not result_file.exists():
                print(f"spotDL job {row['id']}: {log_file.read_text(errors='replace')[-3000:]}", flush=True)
                raise ValueError("Não foi possível baixar essa música agora. Tente outro nome ou link.")
            track = json.loads(result_file.read_text())
            if not re.fullmatch(r"[A-Za-z0-9]{22}", track["id"]) or not (self.root / f"{track['id']}.mp3").is_file():
                raise ValueError("O download não gerou um áudio válido.")
            with self.db() as db:
                db.execute("INSERT OR REPLACE INTO tracks VALUES(?,?)", (track["id"], json.dumps(track)))
                for alias in [row["query"].casefold(), track["origin"]["url"].casefold()]:
                    db.execute("INSERT OR REPLACE INTO aliases VALUES(?,?)", (alias, track["id"]))
                db.execute("UPDATE jobs SET status='ready',track=? WHERE id=?", (track["id"], row["id"]))
        except subprocess.TimeoutExpired:
            print(f"spotDL job {row['id']} timeout: {log_file.read_text(errors='replace')[-3000:]}", flush=True)
            error = "O download demorou demais. Tente novamente em instantes."
        except Exception as exc:
            error = str(exc) if isinstance(exc, ValueError) else "Não foi possível preparar essa música."
        finally:
            result_file.unlink(missing_ok=True)
            log_file.unlink(missing_ok=True)
        if error:
            with self.db() as db:
                db.execute("UPDATE jobs SET status='error',error=? WHERE id=?", (error, row["id"]))
        return True

    def work(self):
        while True:
            if not self.process_one():
                time.sleep(1)


def handler(library):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Não registrar URLs assinadas nem cabeçalhos privados.

        def json(self, status, data):
            body = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + library.secret):
                return self.json(401, {"error": "Não autorizado."})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16384:
                    return self.json(400, {"error": "Pedido inválido."})
                data = json.loads(self.rfile.read(length))
                if self.path == "/v1/jobs":
                    return self.json(200, library.create(data.get("query")))
                if self.path == "/v1/status" and isinstance(data.get("ids"), list):
                    return self.json(200, {"jobs": library.statuses([str(i) for i in data["ids"]])})
                return self.json(404, {"error": "Não encontrado."})
            except (ValueError, TypeError, AttributeError):
                return self.json(400, {"error": "Informe o nome ou o link de uma faixa do Spotify."})

        def do_GET(self):
            target = urlsplit(self.path)
            if target.path == "/health":
                return self.json(200, {"ok": True})
            match = re.fullmatch(r"/media/([A-Za-z0-9]{22})\.mp3", target.path)
            if not match:
                return self.json(404, {"error": "Não encontrado."})
            query = parse_qs(target.query)
            try:
                expires = int(query.get("expires", ["0"])[0])
            except ValueError:
                expires = 0
            signature = query.get("sig", [""])[0]
            if expires < time.time() or expires > time.time() + 8 * 86400 or not hmac.compare_digest(signature, library.sign(match[1], expires)):
                return self.json(403, {"error": "Link expirado."})
            path = library.root / f"{match[1]}.mp3"
            if not path.is_file():
                return self.json(404, {"error": "Arquivo indisponível."})
            size = path.stat().st_size
            start, end = 0, size - 1
            partial = self.headers.get("Range")
            if partial:
                ranges = re.fullmatch(r"bytes=(\d*)-(\d*)", partial)
                if not ranges or not any(ranges.groups()):
                    return self.json(416, {"error": "Faixa inválida."})
                if ranges[1]:
                    start = int(ranges[1]); end = min(int(ranges[2]), end) if ranges[2] else end
                else:
                    start = max(0, size - int(ranges[2]))
                if start > end or start >= size:
                    self.send_response(416); self.send_header("Content-Range", f"bytes */{size}"); self.end_headers(); return
            self.send_response(206 if partial else 200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "private, max-age=3600")
            if partial:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            with path.open("rb") as audio:
                audio.seek(start)
                remaining = end - start + 1
                try:
                    while remaining:
                        chunk = audio.read(min(65536, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk); remaining -= len(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    pass
    return Handler


if __name__ == "__main__":
    secret = os.environ.get("MUSIC_API_KEY", "")
    if len(secret) < 32:
        raise SystemExit("Configure MUSIC_API_KEY com pelo menos 32 caracteres.")
    library = Library(os.environ.get("MUSIC_LIBRARY", "/var/lib/potato-music"), secret, os.environ["MUSIC_PUBLIC_URL"])
    threading.Thread(target=library.work, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("MUSIC_PORT", "8787"))), handler(library)).serve_forever()
