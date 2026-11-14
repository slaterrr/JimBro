"""prepare_sd: hook the JimBro installer into an Imager-flashed SD card's first boot."""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "prepare_sd.py"


def load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("prepare_sd", SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def sd() -> ModuleType:
    return load()


def bootfs(tmp_path: Path) -> Path:
    boot = tmp_path / "bootfs"
    boot.mkdir(parents=True)
    (boot / "config.txt").write_text("arm_64bit=1\n")
    (boot / "cmdline.txt").write_text("console=tty1 root=PARTUUID=x quiet\n")
    return boot


def bundle(tmp_path: Path) -> Path:
    b = tmp_path / "jimbro-usb"
    (b / "app").mkdir(parents=True)
    (b / "install.sh").write_text("#!/bin/bash\n")
    (b / "VERSION").write_text("abc123\n")
    return b


FIRSTRUN = """#!/bin/bash
set +e
CURRENT_HOSTNAME=`cat /etc/hostname | tr -d " \\t\\n\\r"`
echo raspberrypi >/etc/hostname
rm -f /boot/firstrun.sh
sed -i 's| systemd.run.*||g' /boot/cmdline.txt
exit 0
"""


def test_firstrun_hook_inserted_before_self_delete(sd: ModuleType, tmp_path: Path) -> None:
    boot = bootfs(tmp_path)
    (boot / "firstrun.sh").write_text(FIRSTRUN)
    mode = sd.prepare(boot, bundle(tmp_path), hostname="jimbro")
    text = (boot / "firstrun.sh").read_text()
    assert mode == "firstrun"
    assert (boot / "jimbro-usb" / "install.sh").exists()
    hook = text.index("jimbro-usb/install.sh --headless --hostname jimbro")
    assert hook < text.index("rm -f /boot/firstrun.sh")
    assert "/var/log/jimbro-firstboot.log" in text


def test_cloud_init_runcmd_added_or_extended(sd: ModuleType, tmp_path: Path) -> None:
    boot = bootfs(tmp_path)
    (boot / "user-data").write_text("#cloud-config\nhostname: pi\n")
    assert sd.prepare(boot, bundle(tmp_path)) == "cloud-init"
    text = (boot / "user-data").read_text()
    assert "runcmd:\n" in text and "jimbro-usb/install.sh" in text

    boot2 = bootfs(tmp_path / "two")
    (boot2 / "user-data").write_text("#cloud-config\nruncmd:\n  - [echo, hi]\nusers: []\n")
    sd.prepare(boot2, bundle(tmp_path / "two"))
    lines = (boot2 / "user-data").read_text().splitlines()
    i = lines.index("runcmd:")
    assert lines[i + 1] == "  - [echo, hi]" and "jimbro-usb/install.sh" in lines[i + 2]
    assert lines[-1] == "users: []"


def test_idempotent(sd: ModuleType, tmp_path: Path) -> None:
    boot = bootfs(tmp_path)
    (boot / "firstrun.sh").write_text(FIRSTRUN)
    b = bundle(tmp_path)
    sd.prepare(boot, b)
    sd.prepare(boot, b)
    assert (boot / "firstrun.sh").read_text().count("install.sh --headless") == 1


def test_crlf_preserved_as_lf(sd: ModuleType, tmp_path: Path) -> None:
    boot = bootfs(tmp_path)
    (boot / "firstrun.sh").write_bytes(FIRSTRUN.replace("\n", "\r\n").encode())
    sd.prepare(boot, bundle(tmp_path))
    assert b"\r" not in (boot / "firstrun.sh").read_bytes()


def test_rejects_non_boot_partition(sd: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(sd.PrepareError, match="boot partition"):
        sd.prepare(tmp_path, bundle(tmp_path))


def test_requires_imager_customisation(sd: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(sd.PrepareError, match="Imager"):
        sd.prepare(bootfs(tmp_path), bundle(tmp_path))


def test_rejects_missing_bundle(sd: ModuleType, tmp_path: Path) -> None:
    boot = bootfs(tmp_path)
    (boot / "firstrun.sh").write_text(FIRSTRUN)
    with pytest.raises(sd.PrepareError, match="build_usb"):
        sd.prepare(boot, tmp_path / "missing")


def test_invalid_hostname(sd: ModuleType, tmp_path: Path) -> None:
    boot = bootfs(tmp_path)
    (boot / "firstrun.sh").write_text(FIRSTRUN)
    with pytest.raises(sd.PrepareError, match="hostname"):
        sd.prepare(boot, bundle(tmp_path), hostname="bad name;rm")
