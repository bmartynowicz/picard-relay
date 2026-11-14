"""Actual noninteractive first boot; synthetic claim, no real account or key."""
import hashlib,json,os,pathlib,secrets,subprocess
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
p=subprocess.run(elevate+['bash','scripts/setup-linux.sh','--browser'],capture_output=True,text=True,timeout=450)
assert p.returncode==0,p.stdout[-3000:]+p.stderr[-3000:]
assert 'first_run_installed' in p.stdout and claim not in p.stdout+p.stderr
print('Actual browser first-boot installer completed; private claim not logged.')
