import os
import base64
import secrets
from pathlib import Path


def generate_key_file(path="ops/domain-hash-service/secrets/domain_hmac.key", nbytes=32):
    key = secrets.token_bytes(nbytes)
    data = base64.b64encode(key)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)

    try:
        os.chmod(target, 0o600)
    except Exception:
        pass

    return str(target)


if __name__ == "__main__":
    output_path = generate_key_file()
    print(f"Key saved to {output_path}")
