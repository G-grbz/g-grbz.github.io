#!/usr/bin/env python3
"""One-command install snippets for every release package of the four projects.

Writes a tabbed block into the quick setup panels (index.html) and the
installation section of each guide. Run again after editing PROJECTS; the
blocks between the PKG markers are replaced.
"""
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = 'https://api.github.com/repos/G-grbz/{repo}/releases/latest'


def asset_url(repo, select):
    return (f"curl -fsSL {API.format(repo=repo)} \\\n"
            f"  | jq -r '.assets[] | select(.name | {select}) | .browser_download_url' \\\n")


def pacman(repo, select):
    return asset_url(repo, select) + '  | xargs -r sudo pacman -U'


def apt(repo, select, file):
    return asset_url(repo, select) + f'  | xargs -r curl -fLo /tmp/{file} \\\n  && sudo apt install /tmp/{file}'


def dnf(repo, select):
    return asset_url(repo, select) + '  | xargs -r sudo dnf install -y'


def appimage(repo, name):
    path = f'~/Applications/{name}.AppImage'
    return ('mkdir -p ~/Applications \\\n  && ' + asset_url(repo, 'endswith(".AppImage")')
            + f'  | xargs -r curl -fLo {path} \\\n  && chmod +x {path} \\\n  && {path}')


def download(repo, pattern):
    """A direct download button; portal.js resolves the latest asset matching `pattern`."""
    return {'repo': repo, 'match': pattern}


# key, tab label (en, tr), os, file type, hint (en, tr), command
HINT_ARCH = ('Arch Linux, Manjaro, EndeavourOS', 'Arch Linux, Manjaro, EndeavourOS')
HINT_APPIMAGE = ('Any x86-64 distribution. Saved to ~/Applications and opened.', 'Tüm x86-64 dağıtımlar. ~/Applications klasörüne kaydedilip açılır.')

PROJECTS = {
    'gharmonize': {
        'name': 'Gharmonize',
        'packages': [
            ('arch', ('Arch', 'Arch'), 'linux', '.pkg.tar.zst', HINT_ARCH, pacman('Gharmonize', 'endswith("-x64.pkg.tar.zst")')),
            ('deb', ('Debian / Ubuntu', 'Debian / Ubuntu'), 'linux', '.deb', ('Debian, Ubuntu, Linux Mint', 'Debian, Ubuntu, Linux Mint'), apt('Gharmonize', 'endswith("-amd64.deb")', 'gharmonize.deb')),
            ('rpm', ('Fedora', 'Fedora'), 'linux', '.rpm', ('Fedora and other RPM-based distributions', 'Fedora ve diğer RPM tabanlı dağıtımlar'), dnf('Gharmonize', 'endswith(".rpm")')),
            ('appimage', ('AppImage', 'AppImage'), 'linux', '.AppImage', HINT_APPIMAGE, appimage('Gharmonize', 'Gharmonize')),
            ('win-setup', ('Windows', 'Windows'), 'windows', 'Setup .exe', ('Installer. Download it and run it.', 'Kurulum sihirbazı. İndirip çalıştırın.'), download('Gharmonize', r'Setup.*\.exe$')),
            ('win-portable', ('Windows Portable', 'Windows Taşınabilir'), 'windows', 'Portable .exe', ('No installation needed. Download it and run it.', 'Kurulum gerektirmez. İndirip çalıştırın.'), download('Gharmonize', r'Portable\.v.*\.exe$')),
            ('android', ('Android', 'Android'), 'android', '.apk', ('Gharmonize Player client. Download it on the phone and open it; Android may ask you to allow installs from this source.', 'Gharmonize Player istemcisi. Telefonda indirip açın; Android bu kaynaktan kuruluma izin vermenizi isteyebilir.'), download('Gharmonize', r'\.apk$')),
        ],
    },
    'g-tmce': {
        'name': 'G-TMCE',
        'packages': [
            ('aur', ('AUR', 'AUR'), 'linux', 'yay', ('Arch Linux and derivatives, with an AUR helper', 'Arch Linux ve türevleri, AUR yardımcısıyla'), 'yay -S g-tmce'),
            ('appimage', ('AppImage', 'AppImage'), 'linux', '.AppImage', HINT_APPIMAGE, appimage('G-TMCE', 'G-TMCE')),
            ('windows', ('Windows', 'Windows'), 'windows', '.exe', ('No installation needed. Download it and run it.', 'Kurulum gerektirmez. İndirip çalıştırın.'), download('G-TMCE', r'win-x64\.exe$')),
        ],
    },
    'lurviko': {
        'name': 'Lurviko',
        'packages': [
            ('aur', ('AUR', 'AUR'), 'linux', 'yay', ('Arch Linux and derivatives, with an AUR helper', 'Arch Linux ve türevleri, AUR yardımcısıyla'), 'yay -S lurviko'),
            ('arch', ('Arch', 'Arch'), 'linux', '.pkg.tar.zst', HINT_ARCH, pacman('Lurviko', 'endswith("-x86_64.pkg.tar.zst")')),
            ('deb', ('Debian', 'Debian'), 'linux', '.deb', ('Debian 13 (trixie)', 'Debian 13 (trixie)'), apt('Lurviko', 'endswith("_amd64.deb")', 'lurviko.deb')),
            ('rpm', ('Fedora', 'Fedora'), 'linux', '.rpm', ('Fedora 43 and newer', 'Fedora 43 ve üzeri'), dnf('Lurviko', 'endswith(".x86_64.rpm")')),
            ('appimage', ('AppImage', 'AppImage'), 'linux', '.AppImage', ('Any distribution with glibc 2.39 or newer. Saved to ~/Applications and opened.', 'glibc 2.39 veya üzerine sahip tüm dağıtımlar. ~/Applications klasörüne kaydedilip açılır.'), appimage('Lurviko', 'Lurviko')),
        ],
    },
    'g-hotspot': {
        'name': 'G-Hotspot',
        'packages': [
            ('zip', ('Release archive', 'Sürüm arşivi'), 'linux', '.zip', ('Node.js 24 or newer. Unpacks the latest release into your home folder and starts the server.', 'Node.js 24 veya üzeri. Son sürümü ev klasörünüze açar ve sunucuyu başlatır.'),
             asset_url('G-Hotspot', r'test("^G-Hotspot-v[0-9.]+\\.zip$")')
             + '  | xargs -r curl -fLo /tmp/g-hotspot.zip \\\n  && unzip -oq /tmp/g-hotspot.zip -d ~ \\\n'
             + '  && cd "$(ls -d ~/G-Hotspot-v* | sort -V | tail -n 1)" \\\n  && npm start'),
            ('android', ('Android', 'Android'), 'android', '.apk', ('Android app. Download it on the phone and open it; Android may ask you to allow installs from this source.', 'Android uygulaması. Telefonda indirip açın; Android bu kaynaktan kuruluma izin vermenizi isteyebilir.'), download('G-Hotspot', r'-android\.apk$')),
        ],
    },
}

E = lambda s: html.escape(s, quote=True)


def block(slug, indent):
    p = PROJECTS[slug]
    pfx = f'pk-{slug}'
    i = ' ' * indent
    out = [f'{i}<!-- PKG:{slug} -->',
           f'{i}<div class="pkg" data-pkg>',
           f'{i}  <p class="pkg-title" data-tr="Son sürümü kur">Install the latest release</p>',
           f'{i}  <div class="pkg-tabs" role="tablist" aria-label="{E(p["name"])} packages" data-tr-label="{E(p["name"])} paketleri">']
    for key, (en, tr), os_, _, _, _ in p['packages']:
        tr_attr = f' data-tr="{E(tr)}"' if tr != en else ''
        out.append(f'{i}    <button type="button" class="pkg-tab" role="tab" id="{pfx}-tab-{key}" aria-controls="{pfx}-{key}" aria-selected="false" data-os="{os_}"{tr_attr}>{E(en)}</button>')
    out.append(f'{i}  </div>')
    for key, (en, tr), _, ftype, (hint_en, hint_tr), cmd in p['packages']:
        out += [
            f'{i}  <div class="pkg-panel" role="tabpanel" id="{pfx}-{key}" aria-labelledby="{pfx}-tab-{key}">',
            f'{i}    <p class="pkg-hint"><b class="pkg-type">{E(ftype)}</b> <span data-tr="{E(hint_tr)}">{E(hint_en)}</span></p>',
        ]
        if isinstance(cmd, dict):
            latest = f'https://github.com/G-grbz/{cmd["repo"]}/releases/latest'
            out += [
                f'{i}    <div class="pkg-download">',
                f'{i}      <a class="button button-download" href="{latest}" data-asset-repo="{E(cmd["repo"])}" data-asset-match="{E(cmd["match"])}" aria-label="Download {E(p["name"])} ({E(en)})" data-tr-label="{E(p["name"])} ({E(tr)}) indir"><span class="icon icon-download" aria-hidden="true"></span> <span data-tr="İndir">Download</span></a>',
                f'{i}      <span class="pkg-file" data-asset-info></span>',
                f'{i}    </div>',
                f'{i}  </div>',
            ]
            continue
        out += [
            f'{i}    <div class="command">',
            f'{i}      <pre><code>{E(cmd)}</code></pre>',
            f'{i}      <button type="button" class="copy" aria-label="Copy the {E(p["name"])} {E(en)} command" data-tr-label="{E(p["name"])} {E(tr)} komutunu kopyala" hidden><span class="icon icon-copy" aria-hidden="true"></span><span data-tr="Kopyala">Copy</span></button>',
            f'{i}    </div>',
            f'{i}  </div>',
        ]
    linux = any(isinstance(pk[5], str) and 'jq' in pk[5] for pk in p['packages'])
    if linux:
        out.append(f'{i}  <p class="pkg-note"><span data-tr="Linux komutları için">Linux commands need</span> <code>curl</code> <span data-tr="ve">and</span> <code>jq</code><span data-tr=" gerekir. Komutlar her zaman GitHub’daki son sürümü indirir.">. They always download the latest release from GitHub.</span></p>')
    out += [f'{i}</div>', f'{i}<!-- /PKG:{slug} -->']
    return '\n'.join(out)


def put(path, slug, anchor_re, indent):
    text = path.read_text(encoding='utf-8')
    text = re.sub(rf'\n[ ]*<!-- PKG:{slug} -->.*?<!-- /PKG:{slug} -->', '', text, flags=re.S)
    m = re.search(anchor_re, text, flags=re.S)
    if not m:
        raise SystemExit(f'anchor not found in {path}: {anchor_re}')
    text = text[:m.end()] + '\n' + block(slug, indent) + text[m.end():]
    path.write_text(text, encoding='utf-8')


home = ROOT / 'index.html'
for slug in PROJECTS:
    put(home, slug, rf'id="setup-{slug}".*?(?=\n[ ]*<div class="setup-links">)', 16)
for slug in ('gharmonize', 'g-tmce', 'lurviko'):
    put(ROOT / f'projects/{slug}/index.html', slug, r'id="installation".*?</ol>', 12)
put(ROOT / 'projects/g-hotspot/index.html', 'g-hotspot', r'id="installation".*?</div>\n            </div>', 12)
print('ok')
