"""Actual Terraform validation and fail-closed plans. No cloud API or apply."""
import hashlib,io,json,os,pathlib,shutil,subprocess,tempfile,urllib.request,zipfile
assert os.environ.get('GITHUB_ACTIONS')=='true'
repo=pathlib.Path.cwd()
with tempfile.TemporaryDirectory(prefix='picard-terraform-') as temporary:
    root=pathlib.Path(temporary)
    name='terraform_1.5.7_linux_amd64.zip'
    base='https://releases.hashicorp.com/terraform/1.5.7/'
    sums=urllib.request.urlopen(base+'terraform_1.5.7_SHA256SUMS',timeout=30).read(16384).decode()
    expected=next(line.split()[0] for line in sums.splitlines() if line.endswith(name))
    raw=urllib.request.urlopen(base+name,timeout=60).read(40000000)
    assert hashlib.sha256(raw).hexdigest()==expected
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        assert z.namelist()==['terraform']
        (root/'terraform').write_bytes(z.read('terraform'))
    (root/'terraform').chmod(0o700)
    terraform=str(root/'terraform')
    def run(folder,args,success=True):
        p=subprocess.run([terraform,'-chdir='+str(folder),*args],capture_output=True,text=True,timeout=180)
        if success: assert p.returncode==0,p.stdout[-5000:]+p.stderr[-5000:]
        else: assert p.returncode!=0,'Expected allowance refusal'
        return p
    run(repo/'deploy/oracle',['fmt','-check','-recursive'])
    # Qualify what Oracle actually receives, not just the unpackaged checkout.
    assets=root/'assets'
    subprocess.run(['node','scripts/build-oracle-launch.mjs',str(assets)],check=True,timeout=30,capture_output=True)
    stack=root/'stack'
    with zipfile.ZipFile(assets/'oracle-stack.zip') as package:
        assert package.testzip() is None
        assert all(not n.startswith('/') and '..' not in n.split('/') for n in package.namelist())
        package.extractall(stack)
    run(stack,['init','-backend=false','-input=false','-lockfile=readonly','-no-color'])
    run(stack,['validate','-no-color'])
    guard=root/'guard';shutil.copytree(stack/'free-guard',guard)
    run(guard,['init','-backend=false','-input=false','-no-color'])
    good={'region':'us-ashburn-1','home_region':'us-ashburn-1','micro_instances':1,'storage_gb':150,'available_micro_slots':1,'all_compartments_read':True,'owner_confirmed_free':True}
    cases=[{}, {'region':'wrong-region'},{'micro_instances':2},{'storage_gb':151},{'available_micro_slots':0},{'all_compartments_read':False},{'owner_confirmed_free':False},{'storage_gb':-1}]
    for changes in cases:
        (guard/'test.auto.tfvars.json').write_text(json.dumps({'observed':{**good,**changes}}))
        run(guard,['plan','-input=false','-lock=false','-refresh=false','-no-color'],success=not changes)
    print(json.dumps({'state':'oracle_terraform_passed','terraform':'1.5.7','validFreePlan':1,'refusedPlans':len(cases)-1,'cloudApiCalls':0,'resourcesCreated':0}))
