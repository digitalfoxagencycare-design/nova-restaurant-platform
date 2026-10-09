import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("scan_secrets", ROOT / "scripts" / "scan_secrets.py")
scan_secrets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan_secrets)


def test_repo_is_clean():
    assert scan_secrets.scan([str(ROOT)]) == []


def test_scanner_catches_the_leak_shapes_from_the_source_project(tmp_path):
    # Fabricated values that only mimic the shapes. They are assembled at runtime so that no secret-looking literal
    # exists in this file (gitleaks and the repo scanner both scan test sources too).
    j = "".join
    fixtures = {
        "a.py": j(["URL = 'mongodb", "+srv://", "someuser", ":", "Sup3rS3cret", "@cluster9.abc.mongodb.net/db'\n"]),
        "b.py": j(["TOKEN = '", "EA", "A", "x" * 60, "'\n"]),
        "c.py": j(["KEY = '", "rzp_", "live_", "abcdEFGH12345678", "'\n"]),
        "d.py": j(["JWT_", "SECRET = '", "supersecret", "jwtkeyreplace", "inproduction123", "'\n"]),
        "e.yml": j(["ADMIN_", "PASSWORD: '", "hunter22", "hunter", "'\n"]),
        "f.py": j(["CLIENT = '", "hi_", "sec_", "a" * 32, "'\n"]),
    }
    for name, body in fixtures.items():
        (tmp_path / name).write_text(body)
    kinds = {h[2] for h in scan_secrets.scan([str(tmp_path)])}
    assert len(kinds) >= 6, kinds


def test_placeholders_and_env_lookups_are_fine(tmp_path):
    (tmp_path / "ok.py").write_text('import os\nKEY = os.environ["JWT_SECRET"]\nURL = "mongodb://localhost:27017"\n')
    (tmp_path / "ok.md").write_text("`mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net` is the shape\n")
    assert scan_secrets.scan([str(tmp_path)]) == []
