from pathlib import Path
import base64
import secrets
import os


def generate_key_file(path="extensions/desktop/merged/domain_hmac.key", nbytes=32):
    key = secrets.token_bytes(nbytes)
    data = base64.b64encode(key)
    Path(path).write_bytes(data)

    try:
        os.chmod(path, 0o600)
    except Exception:
        pass

    return path


if __name__ == "__main__":
    output_path = generate_key_file()
    print(f"Key saved to {output_path}")
