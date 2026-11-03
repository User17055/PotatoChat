"""Recria no runner a configuração privada do TURN antes do deploy por FTP."""
import base64
import binascii
import os
from pathlib import Path


def prepare(encoded, destination):
    if not encoded:
        raise ValueError("Configure o Secret POTATO_TURN_CONFIG_B64 no repositório antes do deploy.")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("O Secret POTATO_TURN_CONFIG_B64 não contém Base64 válido.") from None
    if not content.startswith(b"<?php") or len(content) > 64000:
        raise ValueError("A configuração privada do TURN é inválida.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "wb") as file:
        file.write(content)


if __name__ == "__main__":
    try:
        prepare(os.environ.get("POTATO_TURN_CONFIG_B64", ""), Path("versao-php/site/turn.config.php"))
    except ValueError as error:
        raise SystemExit(str(error)) from None
    print("Configuração privada do TURN preparada para o FTP.")
