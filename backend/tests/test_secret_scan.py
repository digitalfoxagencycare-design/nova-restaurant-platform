import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("scan_secrets", ROOT / "scripts" / "scan_secrets.py")
scan_secrets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan_secrets)


def test_repo_is_clean():
    assert scan_secrets.scan([str(ROOT)]) == []


def test_scanner_catches_the_leak_shapes_from_the_source_project(tmp_path):
    # fabricated values that only mimic the shapes
    (tmp_path / "a.py").write_text('URL = "mongodb+srv://someuser:Sup3rS3cret@cluster9.abc.mongodb.net/db"\n')  # scan-secrets: allow
    (tmp_path / "b.py").write_text('TOKEN = "EAA' + "x" * 60 + '"\n')
    (tmp_path / "c.py").write_text('KEY = "rzp_live_abcdEFGH12345678"\n')  # scan-secrets: allow
    (tmp_path / "d.py").write_text('JWT_SECRET = "supersecretjwtkeyreplaceinproduction123"\n')  # scan-secrets: allow
    (tmp_path / "e.yml").write_text('ADMIN_PASSWORD: "hunter22hunter"\n')  # scan-secrets: allow
    (tmp_path / "f.py").write_text('CLIENT = "hi_sec_' + "a" * 32 + '"\n')
    kinds = {h[2] for h in scan_secrets.scan([str(tmp_path)])}
    assert len(kinds) >= 6, kinds


def test_placeholders_and_env_lookups_are_fine(tmp_path):
    (tmp_path / "ok.py").write_text('import os\nKEY = os.environ["JWT_SECRET"]\nURL = "mongodb://localhost:27017"\n')
    (tmp_path / "ok.md").write_text("`mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net` is the shape\n")
    assert scan_secrets.scan([str(tmp_path)]) == []
