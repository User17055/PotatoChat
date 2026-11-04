import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("music_service", Path(__file__).resolve().parents[1] / "ops/music-service/server.py")
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)
TRACK = "A" * 22


class MusicServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.library = service.Library(self.temp.name, "test-secret-" * 5, "http://127.0.0.1")
        self.server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.handler(self.library))
        self.library.public_url = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        self.temp.cleanup()

    def post(self, endpoint, body, key=None):
        request = urllib.request.Request(self.library.public_url + endpoint, data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + (key or self.library.secret)})
        with urllib.request.urlopen(request) as response:
            return json.load(response)

    def download(self, args, _):
        (self.library.root / f"{TRACK}.mp3").write_bytes(bytes(range(256)) * 20)
        Path(args[-1]).write_text(json.dumps({"id": TRACK, "title": "Faixa", "artist": "Artista", "duration": 3,
            "origin": {"source": "spotify", "type": "track", "id": TRACK, "url": f"https://open.spotify.com/track/{TRACK}"}}))
        return 0

    def ready_track(self):
        self.library.create("Artista Faixa")
        with patch.object(service, "run_download", side_effect=self.download):
            self.library.process_one()
        return self.library.create("artista faixa")["track"]

    def test_download_once_then_reuse_alias_and_spotify_link(self):
        job = self.post("/v1/jobs", {"query": "Artista Faixa"})
        self.assertEqual(job["status"], "pending")
        self.assertEqual(self.post("/v1/jobs", {"query": "  Artista   Faixa  "})["id"], job["id"])
        with patch.object(service, "run_download", side_effect=self.download) as download:
            self.library.process_one()
            for query in ["artista faixa", f"spotify:track:{TRACK}", f"https://open.spotify.com/track/{TRACK}?si=test"]:
                cached = self.post("/v1/jobs", {"query": query})
                self.assertEqual([cached["status"], cached["cached"], cached["track"]["id"]], ["ready", True, TRACK])
            self.assertEqual(download.call_count, 1)
        self.assertEqual(self.post("/v1/status", {"ids": [job["id"]]})["jobs"][job["id"]]["status"], "ready")

    def test_requests_require_auth_and_arbitrary_urls_are_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as denied:
            self.post("/v1/jobs", {"query": "x"}, key="invalid")
        self.assertEqual(denied.exception.code, 401)
        denied.exception.close()
        for query in ["http://127.0.0.1/private", "file:///etc/passwd", "spotify:playlist:abc", "x\ny",
                      "https://youtube.com.evil.test/watch?v=Erd8iIS7X8Y", "https://youtube.com@127.0.0.1/watch?v=Erd8iIS7X8Y",
                      "https://youtube.com:9999/watch?v=Erd8iIS7X8Y", "https://youtube.com/playlist?list=abc"]:
            with self.assertRaises(ValueError):
                self.library.create(query)

    def test_youtube_links_share_one_download_and_signed_audio(self):
        video = "Erd8iIS7X8Y"
        track_id = "yt_" + video
        canonical = f"https://www.youtube.com/watch?v={video}"
        variants = [canonical + "&list=abc", f"https://youtu.be/{video}?si=abc", f"https://music.youtube.com/watch?v={video}",
                    f"https://m.youtube.com/watch?v={video}&t=10", f"https://www.youtube.com/shorts/{video}"]
        job = self.post("/v1/jobs", {"query": variants[0]})
        for query in variants:
            self.assertEqual(self.post("/v1/jobs", {"query": query})["id"], job["id"])
        def download(args, _):
            (self.library.root / f"{track_id}.mp3").write_bytes(b"audio" * 200)
            Path(args[-1]).write_text(json.dumps({"id": track_id, "title": "Video", "duration": 3,
                "origin": {"source": "youtube", "type": "video", "id": video, "url": canonical}}))
            return 0
        with patch.object(service, "run_download", side_effect=download) as downloader:
            self.library.process_one()
            for query in variants:
                cached = self.post("/v1/jobs", {"query": query})
                self.assertTrue(cached["cached"])
                self.assertEqual(cached["track"]["id"], track_id)
            self.assertEqual(downloader.call_count, 1)
        track = self.post("/v1/jobs", {"query": canonical})["track"]
        with urllib.request.urlopen(urllib.request.Request(track["url"], headers={"Range": "bytes=0-4"})) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.read(), b"audio")
        # IDs de vídeo diferenciam maiúsculas e minúsculas.
        self.assertEqual(self.post("/v1/jobs", {"query": canonical.lower()})["status"], "pending")

    def test_signed_media_range_suffix_and_expiry(self):
        track = self.ready_track()
        request = urllib.request.Request(track["url"], headers={"Range": "bytes=5-12"})
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.read(), bytes(range(5, 13)))
            self.assertEqual(response.headers["Accept-Ranges"], "bytes")
        with urllib.request.urlopen(urllib.request.Request(track["url"], headers={"Range": "bytes=-3"})) as response:
            self.assertEqual(response.read(), bytes([253, 254, 255]))
        for url in [track["url"].replace("sig=", "sig=bad"), self.library.public_url + f"/media/{TRACK}.mp3?expires=1&sig=" + self.library.sign(TRACK, 1)]:
            with self.assertRaises(urllib.error.HTTPError) as denied:
                urllib.request.urlopen(url)
            self.assertEqual(denied.exception.code, 403)
            denied.exception.close()
        with self.assertRaises(urllib.error.HTTPError) as invalid:
            urllib.request.urlopen(urllib.request.Request(track["url"], headers={"Range": "bytes=999999-"}))
        self.assertEqual(invalid.exception.code, 416)
        invalid.exception.close()

    def test_failed_download_does_not_poison_cache_and_can_retry(self):
        job = self.library.create("Artista Faixa")
        with patch.object(service, "run_download", side_effect=subprocess.TimeoutExpired("spotdl", 240)):
            self.library.process_one()
        self.assertEqual(self.library.statuses([job["id"]])[job["id"]]["status"], "error")
        self.assertNotEqual(self.library.create("Artista Faixa")["id"], job["id"])


if __name__ == "__main__":
    unittest.main()
