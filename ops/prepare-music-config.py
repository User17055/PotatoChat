"""Gera a configuração privada da biblioteca de músicas no deploy FTP."""
import base64
import binascii
import os
from pathlib import Path


def prepare(encoded, destination):
    try:
        content = base64.b64decode(encoded or "", validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("POTATO_MUSIC_CONFIG_B64 inválido.") from None
    if not content.startswith(b"<?php") or len(content) > 64000:
        raise ValueError("Configure o Secret POTATO_MUSIC_CONFIG_B64 antes do deploy.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "wb") as file:
        file.write(content)


if __name__ == "__main__":
    prepare(os.environ.get("POTATO_MUSIC_CONFIG_B64"), Path("versao-php/site/music.config.php"))
    print("Biblioteca de músicas configurada para o FTP.")
