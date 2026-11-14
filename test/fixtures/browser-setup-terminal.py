"""Actual noninteractive first boot; synthetic claim, no real account or key."""
import hashlib,json,os,pathlib,re,secrets,subprocess,tempfile
assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('RUNNER_OS')=='Linux'
elevate=[] if os.geteuid()==0 else ['sudo','-n']
claim=secrets.token_urlsafe(32)
data={'v':1,'hostname':'picard.localhost','claimSha256':hashlib.sha256(claim.encode()).hexdigest()}
# Root writes only these two known fresh fixture files; the code is not logged.
program="import os,sys; f=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600); os.write(f,sys.stdin.buffer.read()); os.close(f)"
for name,body in [('/etc/picard-oracle-launch.json',json.dumps(data)),('/run/picard-browser-fixture-claim',claim)]:
    subprocess.run(elevate+['python3','-c',program,name],input=body.encode(),check=True)
subprocess.run(elevate+['chown','root:root','/opt'],check=True)
subprocess.run(elevate+['chmod','0755','/opt'],check=True)
# Install the actual allowlisted publication, not the full repository checkout.
# Native Oracle receives the same reviewed archive from its disposable runner.
if os.environ.get('PICARD_BROWSER_ARCHIVE'):
    archive=pathlib.Path(os.environ['PICARD_BROWSER_ARCHIVE'])
else:
    assets=pathlib.Path(tempfile.mkdtemp(prefix='picard-browser-assets-'))/'assets'
    subprocess.run(['node','scripts/build-oracle-launch.mjs',str(assets)],check=True,capture_output=True,timeout=30)
    archive=next(assets.glob('oracle-host-*.tgz'))
assert re.fullmatch(r'oracle-host-[a-f0-9]{64}\.tgz',archive.name)
assert hashlib.sha256(archive.read_bytes()).hexdigest()==archive.name[12:-4]
target=subprocess.check_output(elevate+['mktemp','-d','/usr/local/src/picard-browser-qualification.XXXXXXXX'],text=True).strip()
assert re.fullmatch(r'/usr/local/src/picard-browser-qualification\.[A-Za-z0-9]+',target)
subprocess.run(elevate+['tar','--extract','--gzip','--no-same-owner','--no-same-permissions','--file',str(archive),'--directory',target],check=True)
p=subprocess.run(elevate+['bash',target+'/scripts/setup-linux.sh','--browser'],capture_output=True,text=True,timeout=450,preexec_fn=lambda:os.umask(0o077))
assert p.returncode==0,p.stdout[-3000:]+p.stderr[-3000:]
assert 'first_run_installed' in p.stdout and claim not in p.stdout+p.stderr
print('Actual browser first-boot installer completed; private claim not logged.')
