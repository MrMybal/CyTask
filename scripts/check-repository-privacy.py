"""Check tracked/staged files without printing credential values or personal paths."""
import argparse
import pathlib
import re
import subprocess
import sys

PROFILE_PATH = re.compile(rb"(?i)[a-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|<)[A-Za-z0-9_.-]+")
LOCAL_PROJECT = re.compile(rb"(?i)[a-z]:[\\/]+_Project[\\/]+")
POSIX_PROFILE = re.compile(rb"(?i)/(?:Users|home)/(?!shared(?:/|\b)|public(?:/|\b)|<)[A-Za-z0-9_.-]+/")
PERSONAL_EMAIL = re.compile(rb"(?i)\b[A-Z0-9._%+-]+@(?:gmail|googlemail|hotmail|outlook|yahoo|icloud)\.[A-Z]{2,}\b")
PRIVATE_KEY = re.compile(rb"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----")
PROVIDER_TOKEN = re.compile(rb"(?<![A-Za-z0-9_-])(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-(?:proj|svcacct|admin|ant)-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{48}|xai-[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{30,})(?![A-Za-z0-9_-])")
NATIVE_SOURCE = re.compile(rb"[A-Za-z]:[\\/][\x20-\x7e]+[\\/]Source[\\/][\x20-\x7e]+\.(?:cpp|h|hpp|inl)\x00")

def git(*args):
    return subprocess.check_output(['git', *args])

def forbidden_path(path):
    parts = pathlib.PurePosixPath(path).parts
    name = parts[-1]
    return (any(p in {'.codex','.cyrevision','.vs'} for p in parts)
            or path == '.openai/hosting.json'
            or (name.startswith('.env') and name not in {'.env.example','.env.sample','.env.template'})
            or name in {'appsettings.Local.json','id_rsa','id_ed25519','credentials.json'}
            or name.endswith(('.pfx','.p12','.dmp','.etl','.suo','.pubxml.user')))

def inspect(path,data):
    issues = []
    if forbidden_path(path):issues.append('private/local file')
    texts = [data]
    if b'\0' in data[:8192]:
        texts.append(b'\n'.join(s[::2] for s in re.findall(rb'(?:[\x20-\x7e]\x00){6,}',data)))
    for rule,pattern in [('Windows user profile path',PROFILE_PATH),('local project path',LOCAL_PROJECT),
                         ('POSIX user profile path',POSIX_PROFILE),('personal email address',PERSONAL_EMAIL),
                         ('private key',PRIVATE_KEY),('provider access token',PROVIDER_TOKEN)]:
        if any(pattern.search(t) for t in texts):issues.append(rule)
    if data.startswith(b'MZ') and NATIVE_SOURCE.search(data):issues.append('native diagnostic source path')
    return issues

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--staged',action='store_true')
    args=parser.parse_args()
    if args.staged:
        changed=set(git('diff','--cached','--name-only','--diff-filter=ACMR','-z').split(b'\0'))
        entries=git('ls-files','--stage','-z').split(b'\0')
        files=[]
        for entry in entries:
            if not entry:continue
            meta,path=entry.split(b'\t',1)
            if path in changed:files.append((meta.split()[1],path.decode('utf8')))
        emails=[git('config','user.email').strip().lower()]
    else:
        files=[]
        for entry in git('ls-tree','-rz','HEAD').split(b'\0'):
            if not entry:continue
            meta,path=entry.split(b'\t',1)
            if meta.split()[1]==b'blob':files.append((meta.split()[2],path.decode('utf8')))
        emails=set(git('log','--all','--format=%ae%n%ce').lower().splitlines())
        emails.update(git('for-each-ref','--format=%(taggeremail)','refs/tags').lower().replace(b'<',b'').replace(b'>',b'').splitlines())
    issues=[]
    proc=subprocess.Popen(['git','cat-file','--batch'],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    for oid,path in files:
        proc.stdin.write(oid+b'\n');proc.stdin.flush()
        header=proc.stdout.readline().split();data=proc.stdout.read(int(header[2]));proc.stdout.read(1)
        for reason in inspect(path,data):issues.append(f'{path}: {reason}')
    proc.stdin.close();proc.wait()
    bad_emails=[e for e in emails if e and not (e.endswith(b'@users.noreply.github.com') or e==b'noreply@github.com')]
    if bad_emails:issues.append('Commit/tag identity must use a GitHub noreply email address.')
    if issues:
        print('\n'.join(issues),file=sys.stderr)
        return 1
    print(f'Privacy checks passed for {len(files)} files and commit/tag identities.')
    return 0

if __name__=='__main__':sys.exit(main())
