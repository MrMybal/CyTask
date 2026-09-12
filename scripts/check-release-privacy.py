"""Inspect a prepared distribution directory without printing matched values."""
import argparse
import hashlib
import pathlib
import re
import sys

PATTERNS = (
    ('Windows user profile path', re.compile(rb'(?i)[a-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|<)[A-Za-z0-9_.-]+')),
    ('local project path', re.compile(rb'(?i)[a-z]:[\\/]+_Project[\\/]+')),
    ('POSIX user profile path', re.compile(rb'(?i)/(?:Users|home)/(?!shared(?:/|\b)|public(?:/|\b)|<)[A-Za-z0-9_.-]+/')),
    ('personal email address', re.compile(rb'(?i)\b[A-Z0-9._%+-]+@(?:gmail|googlemail|hotmail|outlook|yahoo|icloud)\.[A-Z]{2,}\b')),
    ('private key', re.compile(rb'-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----')),
    ('provider access token', re.compile(rb'(?<![A-Za-z0-9_-])(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-(?:proj|svcacct|admin|ant)-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{48}|xai-[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{30,})(?![A-Za-z0-9_-])')),
)
FORBIDDEN_SUFFIXES = {'.pdb', '.map', '.dmp', '.etl', '.binlog', '.db', '.sqlite', '.sqlite3', '.bak', '.backup'}
FORBIDDEN_NAMES = {'.env', 'credentials.json', 'appsettings.local.json', 'id_rsa', 'id_ed25519'}
CHUNK_SIZE = 8 * 1024 * 1024
OVERLAP = 4096

def inspect_file(path):
    issues = set()
    if path.name.lower() in FORBIDDEN_NAMES or path.suffix.lower() in FORBIDDEN_SUFFIXES:
        issues.add(('private, diagnostic or source-map file', None))
    carry = b''
    with path.open('rb') as stream:
        while True:
            chunk = stream.read(CHUNK_SIZE)
            if not chunk:
                break
            data = carry + chunk
            views = (data, data.replace(b'\0', b''))
            for reason, pattern in PATTERNS:
                for view in views:
                    for match in pattern.finditer(view):
                        digest = hashlib.sha256(match.group(0).replace(b'\0', b'')).hexdigest()
                        issues.add((reason, digest))
            carry = data[-OVERLAP:]
    return sorted(issues, key=lambda item: (item[0], item[1] or ''))

def sha256_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(CHUNK_SIZE), b''):
            digest.update(chunk)
    return digest.hexdigest()

def trusted_electron_data(directory):
    executable = directory / 'electron.exe'
    licenses = directory / 'LICENSES.chromium.html'
    if not executable.is_file() or not licenses.is_file():
        raise ValueError('trusted Electron runtime is incomplete')
    accepted_reasons = {'personal email address', 'POSIX user profile path'}
    runtime_matches = {
        (reason, digest) for reason, digest in inspect_file(executable)
        if reason in accepted_reasons and digest is not None
    }
    return runtime_matches, sha256_file(licenses)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', nargs='+', type=pathlib.Path)
    parser.add_argument('--electron-runtime', type=pathlib.Path)
    args = parser.parse_args()
    issues = []
    files = []
    try:
        runtime_matches, license_hash = trusted_electron_data(args.electron_runtime.resolve()) if args.electron_runtime else (set(), None)
    except ValueError as error:
        parser.error(str(error))
    for supplied in args.paths:
        candidate = supplied.resolve()
        if candidate.is_symlink():
            issues.append(f'{supplied.name}: symbolic link')
        elif candidate.is_file():
            files.append((supplied.name, candidate))
        elif candidate.is_dir():
            for path in sorted(candidate.rglob('*')):
                relative = path.relative_to(candidate).as_posix()
                if path.is_symlink():
                    issues.append(f'{supplied.name}/{relative}: symbolic link')
                elif path.is_file():
                    files.append((f'{supplied.name}/{relative}', path))
        else:
            parser.error(f'path does not exist: {supplied.name}')
    for display, path in files:
        normalized_display = display.replace('\\', '/')
        is_packaged_electron = normalized_display == 'win-unpacked/CyTask.exe'
        is_exact_chromium_license = (normalized_display == 'win-unpacked/LICENSES.chromium.html'
                                     and license_hash is not None and sha256_file(path) == license_hash)
        for reason, digest in inspect_file(path):
            known_runtime_string = (is_packaged_electron and reason in {'personal email address', 'POSIX user profile path'}
                                    and digest is not None and (reason, digest) in runtime_matches)
            known_license_content = is_exact_chromium_license and reason == 'personal email address'
            if not known_runtime_string and not known_license_content:
                issues.append(f'{display}: {reason}')
    if issues:
        print('\n'.join(issues), file=sys.stderr)
        return 1
    print(f'Release privacy checks passed for {len(files)} files from {len(args.paths)} input(s).')
    return 0

if __name__ == '__main__':
    sys.exit(main())
