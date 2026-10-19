// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { test } = require("node:test");
const { validateRuntime } = require("../../scripts/enterprise-runtime-entrypoint.cjs");
const { validateTree } = require("../../scripts/prepare-enterprise-runtime.cjs");
const receipt = {
  schemaVersion: 1,
  sourceSha: "a".repeat(40),
  publicOrigin: "https://cal-enterprise.example.test",
};
const environment = () => ({
  NEXT_PUBLIC_WEBAPP_URL: receipt.publicOrigin,
  NEXTAUTH_URL: `${receipt.publicOrigin}/api/auth`,
  DATABASE_URL: "postgresql://fixture:fixture@localhost/calcom_enterprise",
  DATABASE_DIRECT_URL: "postgresql://fixture:fixture@localhost/calcom_enterprise",
  CAL_ENTERPRISE_EXPECTED_DATABASE: "calcom_enterprise",
  NEXTAUTH_SECRET: "n".repeat(32),
  CALENDSO_ENCRYPTION_KEY: "e".repeat(32),
  CAL_AUTHENTIK_ENABLED: "true",
  CAL_AUTHENTIK_ONLY: "true",
  CAL_AUTHENTIK_ISSUER: "https://identity.example.test/application/o/cal-enterprise",
  CAL_AUTHENTIK_CLIENT_ID: "fixture-client",
  CAL_AUTHENTIK_CLIENT_SECRET: "fixture-client-secret",
});
test("web preflight accepts the exact configured artifact without returning secret values", () => {
  assert.deepEqual(validateRuntime(environment(), receipt, "web"), {
    sourceSha: receipt.sourceSha,
    publicOrigin: receipt.publicOrigin,
    operation: "web",
  });
});
for (const [name, value] of [
  ["NEXT_PUBLIC_WEBAPP_URL", "http://localhost:3000"],
  ["NEXT_PUBLIC_WEBAPP_URL", `${receipt.publicOrigin}/other`],
  ["NEXTAUTH_URL", "https://foreign.example.test/api/auth"],
  ["CAL_AUTHENTIK_ENABLED", "false"],
  ["CAL_AUTHENTIK_ONLY", "false"],
  ["CAL_AUTHENTIK_ONLY", undefined],
  ["NEXTAUTH_SECRET", "short"],
  ["CALENDSO_ENCRYPTION_KEY", ""],
  ["CAL_AUTHENTIK_CLIENT_SECRET", ""],
  ["DATABASE_URL", "mysql://localhost/calcom_enterprise"],
]) {
  test(`web preflight rejects mismatched or missing ${name}`, () => {
    assert.throws(() => validateRuntime({ ...environment(), [name]: value }, receipt, "web"));
  });
}
test("explicit migration mode requires the intended database", () => {
  assert.equal(validateRuntime(environment(), receipt, "migrate").operation, "migrate");
  assert.throws(() =>
    validateRuntime({ ...environment(), CAL_ENTERPRISE_EXPECTED_DATABASE: "legacy" }, receipt, "migrate")
  );
  assert.throws(() =>
    validateRuntime(
      { ...environment(), DATABASE_DIRECT_URL: "postgresql://localhost/legacy" },
      receipt,
      "migrate"
    )
  );
});
test("invalid build identities and arbitrary operation names are refused", () => {
  assert.throws(() => validateRuntime(environment(), { ...receipt, sourceSha: "latest" }, "web"));
  assert.throws(() => validateRuntime(environment(), receipt, "shell"));
});
test("runtime context rejects escaping symlinks and environment files", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cal-enterprise-context-"));
  try {
    await fs.writeFile(path.join(directory, "valid.json"), "{}");
    await validateTree(directory);
    await fs.symlink("/etc/passwd", path.join(directory, "escape"));
    await assert.rejects(validateTree(directory));
    await fs.unlink(path.join(directory, "escape"));
    await fs.writeFile(path.join(directory, ".env.production"), "NOT_A_REAL_SECRET=fixture");
    await assert.rejects(validateTree(directory));
  } finally {
    await fs.rm(directory, { recursive: true });
  }
});

test("web and shared authentication use the same patched NextAuth release", async () => {
  const root = path.resolve(__dirname, "../..");
  const web = JSON.parse(await fs.readFile(path.join(root, "apps/web/package.json"), "utf8"));
  const auth = JSON.parse(await fs.readFile(path.join(root, "packages/features/auth/package.json"), "utf8"));
  assert.equal(web.dependencies["next-auth"], auth.dependencies["next-auth"]);
  const atLeast = (actual, minimum) => {
    assert.match(actual, /^\d+\.\d+\.\d+$/);
    const a = actual.split(".").map(Number),
      b = minimum.split(".").map(Number);
    return a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2])));
  };
  assert.ok(atLeast(web.dependencies["next-auth"], "4.24.15"));
  assert.ok(atLeast(web.dependencies.next, "16.3.6"));
  assert.ok(atLeast(web.dependencies.handlebars, "4.7.10"));
});

async function sourceFixture(run) {
  const { execFileSync } = require("node:child_process");
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "cal-enterprise-source-"));
  const directory = path.join(base, "source");
  await fs.mkdir(directory);
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.test",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.test",
      },
    }).trim();
  const write = async (name, data = "fixture") => {
    const file = path.join(directory, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  };
  try {
    git("init", "--initial-branch=fixture");
    await write(".gitignore", "node_modules/\napps/web/.next/\n");
    for (const name of [
      "yarn.lock",
      "scripts/enterprise-runtime-entrypoint.cjs",
      "scripts/check-enterprise-migration.sql",
      "Dockerfile.enterprise-preview",
      "packages/prisma/schema.prisma",
      "packages/prisma/migrations/fixture/migration.sql",
      "apps/web/public/fixture.txt",
    ])
      await write(name);
    git("add", ".");
    git("commit", "-m", "fixture source");
    const source = git("rev-parse", "HEAD");
    await write("apps/web/.next/standalone/apps/web/.next/BUILD_ID", "fixture-build");
    await write("apps/web/.next/build-manifest.json", "{}");
    await write("apps/web/.next/static/fixture.js");
    await write("node_modules/prisma/package.json", '{"version":"6.16.1"}');
    await write("node_modules/prisma/build/index.js");
    await write("node_modules/@prisma/engines/package.json", '{"version":"6.16.1"}');
    const hash = (data) => require("node:crypto").createHash("sha256").update(data).digest("hex");
    const receiptPath = path.join(base, "receipt.json");
    await fs.writeFile(
      receiptPath,
      JSON.stringify({
        source,
        public_origin: "https://cal-enterprise.example.test",
        build_id: "fixture-build",
        manifest_sha256: hash("{}"),
        lock_before: hash("fixture"),
        lock_after: hash("fixture"),
        results: Object.fromEntries(
          ["install", "generate", "app-registry", "trpc", "assets", "web-build"].map((name) => [
            name,
            { exit_code: 0 },
          ])
        ),
      })
    );
    await run({ directory, source, git, write, receiptPath, output: path.join(base, "context") });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
}

function preparerFor(directory, { duringTrace, duringNotices } = {}) {
  const nativeRequire = require;
  const fixtureRequire = (name) => {
    if (name === "next/dist/compiled/@vercel/nft")
      return {
        nodeFileTrace: async () => {
          if (duringTrace) await duringTrace();
          return { fileList: new Set(), warnings: new Set() };
        },
      };
    if (name === "./retain-enterprise-notices.cjs")
      return {
        retainNotices: async (output) => {
          if (duringNotices) await duringNotices(output);
          return 0;
        },
      };
    return nativeRequire(name);
  };
  fixtureRequire.resolve = (name, options) => nativeRequire.resolve(name, options);
  const loaded = { exports: {} };
  const code = require("node:fs").readFileSync(
    path.resolve(__dirname, "../../scripts/prepare-enterprise-runtime.cjs"),
    "utf8"
  );
  // Execute the real preparer with real Git/filesystem/tar; only the expensive
  // dependency trace and notice collection are explicit miniature-fixture seams.
  new Function("require", "module", "exports", "__dirname", code)(
    fixtureRequire,
    loaded,
    loaded.exports,
    path.join(directory, "scripts")
  );
  return loaded.exports;
}

test("packaging accepts a clean exact source and ignores generated build outputs", async () => {
  await sourceFixture(async ({ directory, source, receiptPath, output }) => {
    const { prepare, validateSource } = preparerFor(directory);
    assert.equal(validateSource(directory, source), source);
    await prepare(output, receiptPath);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(output, "enterprise-build.json"), "utf8")).sourceSha,
      source
    );
  });
});
for (const kind of ["tracked", "staged", "untracked"]) {
  test(`packaging refuses ${kind} source before creating its output`, async () => {
    await sourceFixture(async ({ directory, write, git, receiptPath, output }) => {
      const filename =
        kind === "untracked" ? "unpublished-provider.ts" : "scripts/enterprise-runtime-entrypoint.cjs";
      await write(filename, "uncommitted fixture change");
      if (kind === "staged") git("add", filename);
      await assert.rejects(preparerFor(directory).prepare(output, receiptPath), /Uncommitted source changes/);
      await assert.rejects(fs.stat(output), { code: "ENOENT" });
    });
  });
}
test("packaging refuses wrong and malformed source identities", async () => {
  await sourceFixture(async ({ directory }) => {
    const { validateSource } = preparerFor(directory);
    for (const value of [undefined, null, "latest", "", "A".repeat(40)])
      assert.throws(() => validateSource(directory, value), /Invalid source revision/);
    assert.throws(() => validateSource(directory, "a".repeat(40)), /Wrong source revision/);
  });
});
for (const committed of [false, true]) {
  test(`source ${committed ? "commit" : "edit"} during preparation prevents a completion manifest`, async () => {
    await sourceFixture(async ({ directory, write, git, receiptPath, output }) => {
      const { prepare } = preparerFor(directory, {
        duringTrace: async () => {
          await write("scripts/enterprise-runtime-entrypoint.cjs", "changed during copy");
          if (committed) {
            git("add", ".");
            git("commit", "-m", "new source");
          }
        },
      });
      await assert.rejects(
        prepare(output, receiptPath),
        committed ? /Wrong source revision/ : /Uncommitted source changes/
      );
      await assert.rejects(fs.stat(path.join(output, "enterprise-build.json")), { code: "ENOENT" });
    });
  });
}
test("invalid runtime context does not retain a completion manifest", async () => {
  await sourceFixture(async ({ directory, receiptPath, output }) => {
    const { prepare } = preparerFor(directory, {
      duringNotices: (target) => fs.writeFile(path.join(target, ".env"), "FIXTURE_ONLY=not-a-secret"),
    });
    await assert.rejects(prepare(output, receiptPath), /Environment or Git data/);
    await assert.rejects(fs.stat(path.join(output, "enterprise-build.json")), { code: "ENOENT" });
  });
});

// The image, scanner/native receipts, provider transport and registry are explicit
// fixtures. Production admission, OCI/layer parsing, source reads and digest checks run.
const prebuiltFixture = String.raw`
import copy, datetime as dt, gzip, importlib.util, io, json, os, pathlib, subprocess, sys, tarfile, tempfile, types
root=pathlib.Path(sys.argv[1]); scenario=sys.argv[2]
spec=importlib.util.spec_from_file_location('publisher',root/'scripts/publish-enterprise-prebuilt.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
source=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
if scenario=='tree-as-source':source=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD^{tree}'],text=True).strip()
now=dt.datetime.now(dt.timezone.utc); timestamp=now.isoformat(timespec='seconds').replace('+00:00','Z')
def encoded(v): return json.dumps(v,separators=(',',':')).encode()
def response(code=0,out=b'',err=b''): return types.SimpleNamespace(returncode=code,stdout=out,stderr=err)
with tempfile.TemporaryDirectory(prefix='cal-prebuilt-fixture-') as temp:
 d=pathlib.Path(temp)/'bundle'; d.mkdir()
 checkout=root
 publisher_sha=source
 if scenario=='source-revision':
  checkout=pathlib.Path(temp)/'recipe-fixture';checkout.mkdir()
  env={**os.environ,'GIT_AUTHOR_NAME':'Fixture','GIT_AUTHOR_EMAIL':'fixture@example.test','GIT_COMMITTER_NAME':'Fixture','GIT_COMMITTER_EMAIL':'fixture@example.test'}
  def git(*args):return subprocess.check_output(['git','-C',str(checkout),'-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',*args],env=env,stderr=subprocess.PIPE,text=True).strip()
  git('init','--initial-branch=fixture')
  for file in m.RECIPES.values():
   p=checkout/file;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(m.git_bytes(root,source,file))
  git('add','.');git('commit','-m','fixture application recipes');source=git('rev-parse','HEAD')
  (checkout/'Dockerfile.enterprise-preview').write_text('publisher revision differs from application')
  git('add','.');git('commit','-m','fixture publisher revision');publisher_sha=git('rev-parse','HEAD')
 build={'schemaVersion':1,'sourceSha':source,'publicOrigin':m.ORIGIN,'buildId':'fixture-build','buildManifestSha256':m.sha(b'{}'),
        'migrationEngineVersion':'6.16.1','operationsTraceFiles':743,'copiedLicenseNotices':760,'traceWarnings':[]}
 for key,file in m.RECIPES.items(): build[key]=m.sha(m.git_bytes(checkout,source,file))
 config={'os':'linux','architecture':'amd64','config':{'User':'1000:1000','WorkingDir':'/calcom',
  'Entrypoint':['node','/calcom/scripts/enterprise-runtime-entrypoint.cjs'],'Cmd':['web'],'Env':['NODE_ENV=production'],
  'Labels':{'org.opencontainers.image.source':'https://github.com/'+m.REPOSITORY,'org.opencontainers.image.revision':source,
   'io.mereka.cal.build-id':build['buildId'],'io.mereka.cal.dockerfile-sha256':build['dockerfileSha256'],
   'io.mereka.cal.entrypoint-sha256':build['entrypointSha256'],'io.mereka.cal.distribution':'community-enterprise-preview'}},
  'rootfs':{'type':'layers','diff_ids':[]}}
 if scenario=='wrong-platform': config['architecture']='arm64'
 if scenario=='root-user': config['config']['User']='0'
 if scenario=='wrong-entrypoint': config['config']['Entrypoint']=['yarn','start']
 if scenario=='wrong-label': config['config']['Labels']['org.opencontainers.image.revision']='0'*40
 if scenario=='secret-env': config['config']['Env'].append('NEXTAUTH_SECRET=fixture-only-must-not-print')
 layer_files={'calcom/enterprise-build.json':encoded(build),'calcom/apps/web/.next/BUILD_ID':b'fixture-build',
              'calcom/apps/web/.next/build-manifest.json':b'{}'}
 for key,file in m.RECIPES.items():
  if key in ['entrypointSha256','migrationPreflightSha256']:layer_files['calcom/'+file]=m.git_bytes(checkout,source,file)
 if scenario=='wrong-shipped-build': layer_files['calcom/apps/web/.next/BUILD_ID']=b'other-build'
 if scenario=='wrong-shipped-recipe': layer_files['calcom/scripts/enterprise-runtime-entrypoint.cjs']=b'changed'
 if scenario=='missing-shipped-manifest':layer_files.pop('calcom/enterprise-build.json')
 for file,name in m.REQUIRED.items():layer_files[file]=encoded({'name':name,'version':'1.0.0'})
 if scenario=='ambiguous-package':layer_files['calcom/node_modules/extra/package.json']=encoded({'name':'extra'})
 if scenario=='module-marker':layer_files['calcom/node_modules/next/esm/package.json']=encoded({'type':'module'})
 layer_files['var/lib/dpkg/status']=b'Package: fixture-os\nStatus: install ok installed\nVersion: 1.0\nArchitecture: amd64\n\n'
 extra='calcom/node_modules/next/node_modules/extra/package.json'
 if scenario in ['nested-copy-missing','nested-copy-included','removed-copy','opaque-copy']:
  layer_files[extra]=encoded({'name':'extra','version':'2.0.0'})
 layers=[layer_files]
 if scenario=='whiteout':layers.append({'calcom/.wh.enterprise-build.json':b''})
 if scenario=='removed-copy':layers.append({'calcom/node_modules/next/node_modules/.wh.extra':b''})
 if scenario=='opaque-copy':layers.append({'calcom/node_modules/next/node_modules/.wh..wh..opq':b''})
 if scenario in ['replaced-copy','replaced-copy-old-scan']:
  layers.append({'calcom/node_modules/next/package.json':encoded({'name':'next','version':'2.0.0'})})
 if scenario=='same-layer-opaque-replacement':
  layers[0][extra]=encoded({'name':'extra','version':'0.0.0'})
  layers.append({extra:encoded({'name':'extra','version':'2.0.0'}),'calcom/node_modules/next/node_modules/.wh..wh..opq':b''})
 alias_scenarios={'package-alias','alias-next-hashed','alias-absolute','alias-chain','alias-depth40','alias-depth41',
  'alias-cycle','alias-escape','alias-dangling','alias-file','alias-hardlink','alias-package-json','alias-target-marker',
  'alias-outside-inventory','alias-componentwise-escape','alias-replaced-ancestor','alias-whiteout-target',
  'alias-opaque-target','alias-removed','alias-whiteout-replacement','alias-duplicate-coverage','alias-dpkg-ancestor'}
 alias_entries={}
 if scenario in alias_scenarios:alias_entries['calcom/node_modules/alias']=(tarfile.SYMTYPE,'next')
 if scenario=='alias-next-hashed':
  alias_entries={'calcom/apps/web/.next/node_modules/next-hashed':(tarfile.SYMTYPE,'../../../../node_modules/next')}
 if scenario=='alias-absolute':alias_entries['calcom/node_modules/alias']=(tarfile.SYMTYPE,'/calcom/node_modules/next')
 if scenario in ['alias-chain','alias-cycle']:
  alias_entries={'calcom/node_modules/alias':(tarfile.SYMTYPE,'second'),'calcom/node_modules/second':(tarfile.SYMTYPE,'next' if scenario=='alias-chain' else 'alias')}
 if scenario in ['alias-depth40','alias-depth41']:
  count=40 if scenario=='alias-depth40' else 41
  alias_entries={'calcom/node_modules/link'+str(i):(tarfile.SYMTYPE,'link'+str(i+1) if i<count-1 else 'next') for i in range(count)}
 if scenario=='alias-escape':alias_entries['calcom/node_modules/alias']=(tarfile.SYMTYPE,'../../../outside')
 if scenario=='alias-dangling':alias_entries['calcom/node_modules/alias']=(tarfile.SYMTYPE,'missing')
 if scenario=='alias-file':alias_entries['calcom/node_modules/alias']=(tarfile.SYMTYPE,'next/package.json')
 if scenario=='alias-hardlink':alias_entries['calcom/node_modules/alias']=(tarfile.LNKTYPE,'calcom/node_modules/next')
 if scenario=='alias-package-json':
  alias_entries={'calcom/node_modules/alias/package.json':(tarfile.SYMTYPE,'../../next/package.json')}
 if scenario=='alias-target-marker':layers[0]['calcom/node_modules/next/package.json']=encoded({'type':'module'})
 if scenario=='alias-outside-inventory':
  alias_entries['calcom/node_modules/alias']=(tarfile.SYMTYPE,'../packages/shared')
  layers[0]['calcom/packages/shared/package.json']=encoded({'name':'@calcom/shared','version':'1.0.0'})
 if scenario=='alias-componentwise-escape':
  alias_entries={'calcom/node_modules/alias':(tarfile.SYMTYPE,'../jump/../../outside'),'calcom/jump':(tarfile.SYMTYPE,'/calcom')}
 if scenario=='alias-replaced-ancestor':
  alias_entries['calcom/node_modules/alias']=(tarfile.SYMTYPE,'target')
  layers[0]['calcom/node_modules/target/package.json']=encoded({'name':'target','version':'1.0.0'})
  layers.append({'calcom/node_modules/target':b'replaced directory'})
 if scenario=='alias-whiteout-target':layers.append({'calcom/node_modules/.wh.next':b''})
 if scenario=='alias-opaque-target':layers.append({'calcom/node_modules/next/.wh..wh..opq':b''})
 if scenario=='alias-removed':layers.append({'calcom/node_modules/.wh.alias':b''})
 if scenario=='alias-whiteout-replacement':
  layers.append({'calcom/node_modules/next/package.json':encoded({'name':'next','version':'2.0.0'}),'calcom/node_modules/.wh.next':b''})
 if scenario=='alias-dpkg-ancestor':
  layers.append({});alias_entries={'var/lib/dpkg':(tarfile.SYMTYPE,'../dpkg-target')}
 layer_blobs=[];layer_descriptors=[];config['rootfs']['diff_ids']=[]
 for layer_number,layer_files in enumerate(layers):
  layerbuf=io.BytesIO()
  with tarfile.open(fileobj=layerbuf,mode='w') as tar:
   for name,data in layer_files.items():
    info=tarfile.TarInfo(name); info.size=len(data);tar.addfile(info,io.BytesIO(data))
   if scenario=='duplicate-package':
    info=tarfile.TarInfo('calcom/node_modules/next/package.json');data=layer_files[info.name];info.size=len(data);tar.addfile(info,io.BytesIO(data))
   if layer_number==(1 if scenario=='alias-dpkg-ancestor' else 0):
    for name,(kind,target) in alias_entries.items():
     info=tarfile.TarInfo(name);info.type=kind;info.linkname=target;tar.addfile(info)
  layer=layerbuf.getvalue();config['rootfs']['diff_ids'].append('sha256:'+m.sha(layer))
  compressed=scenario in ['gzip','corrupt-gzip','gzip-bound','gzip-deadline']
  blob=gzip.compress(layer,mtime=0) if compressed else layer
  if scenario=='corrupt-gzip':blob=b'not gzip'
  layer_blobs.append(blob)
  if scenario=='gzip-bound':m.MAX_EXPANDED=len(layer)-1
  if scenario=='gzip-deadline':m.READ_SECONDS=-1
 config_bytes=encoded(config);config_digest='sha256:'+m.sha(config_bytes)
 def desc(data,mt):return {'mediaType':mt,'digest':'sha256:'+m.sha(data),'size':len(data)}
 manifest={'schemaVersion':2,'mediaType':m.MANIFEST,'config':desc(config_bytes,'application/vnd.oci.image.config.v1+json'),
           'layers':[desc(blob,'application/vnd.oci.image.layer.v1.tar'+('+gzip' if compressed else '')) for blob in layer_blobs]}
 if scenario=='config-created-annotation':manifest['config']['annotations']={'org.opencontainers.image.created':timestamp}
 if scenario=='layer-created-annotation':manifest['layers'][0]['annotations']={'org.opencontainers.image.created':timestamp}
 manifest_bytes=encoded(manifest);manifest_digest='sha256:'+m.sha(manifest_bytes)
 index={'schemaVersion':2,'manifests':[desc(manifest_bytes,m.MANIFEST)]}
 created_cases={'created-annotation':timestamp,'created-nanoseconds':timestamp.replace('Z','.123456789Z'),
  'created-invalid-date':'2026-02-30T00:00:00Z','created-invalid-leap':'2025-02-29T00:00:00Z',
  'created-invalid-hour':'2026-10-19T25:00:00Z','created-non-utc':'2026-10-19T00:00:00+08:00',
  'created-missing-zone':'2026-10-19T00:00:00','created-too-precise':'2026-10-19T00:00:00.1234567890Z',
  'created-overlong':'x'*2001,'created-wrong-type':True}
 if scenario in created_cases:index['manifests'][0]['annotations']={'org.opencontainers.image.created':created_cases[scenario]}
 if scenario=='created-unknown-annotation':index['manifests'][0]['annotations']={'unknown':'fixture'}
 if scenario=='created-extra-annotation':index['manifests'][0]['annotations']={'org.opencontainers.image.created':timestamp,'extra':'fixture'}
 if scenario=='created-ref-name':index['manifests'][0]['annotations']={'org.opencontainers.image.ref.name':'fixture-tag'}
 if scenario=='created-empty-annotations':index['manifests'][0]['annotations']={}
 if scenario=='created-annotations-type':index['manifests'][0]['annotations']=[]
 if scenario=='created-unknown-descriptor-key':
  index['manifests'][0]['annotations']={'org.opencontainers.image.created':timestamp};index['manifests'][0]['urls']=['https://example.invalid']
 if scenario=='index-platform':index['manifests'][0]['platform']={'os':'linux','architecture':'arm64'}
 if scenario=='multiple-platforms':index['manifests'].append(index['manifests'][0])
 members={'oci-layout':encoded({'imageLayoutVersion':'1.0.0'}),'index.json':encoded(index),
          'blobs/sha256/'+m.sha(config_bytes):config_bytes,
          'blobs/sha256/'+m.sha(manifest_bytes):manifest_bytes}
 for blob in layer_blobs:members['blobs/sha256/'+m.sha(blob)]=blob
 if scenario=='corrupt-blob':members['blobs/sha256/'+m.sha(layer_blobs[0])]=b'x'*len(layer_blobs[0])
 if scenario=='missing-blob':members.pop('blobs/sha256/'+m.sha(layer_blobs[0]))
 if scenario=='unreferenced-blob':members['blobs/sha256/'+m.sha(b'extra')]=b'extra'
 if scenario=='traversal':members['../outside']=b'no'
 with tarfile.open(d/m.FILES['archive'],mode='w') as tar:
  for name,data in members.items():
   info=tarfile.TarInfo(name);info.size=len(data);tar.addfile(info,io.BytesIO(data))
  if scenario=='duplicate-member':
   info=tarfile.TarInfo('index.json');info.size=len(members['index.json']);tar.addfile(info,io.BytesIO(members['index.json']))
  if scenario in ['symlink','device']:
   info=tarfile.TarInfo('blobs');info.type=tarfile.SYMTYPE if scenario=='symlink' else tarfile.CHRTYPE
   info.linkname='/tmp/fixture-only';tar.addfile(info)
 identity={'schemaVersion':1,'sourceSha':source,'manifestDigest':manifest_digest,'configDigest':config_digest,'completedAt':timestamp,'exitCode':0}
 container={**identity,'publicOrigin':m.ORIGIN,'buildId':build['buildId'],'nativeReceiptSha256':m.sha(b'private native fixture'),
  'expectedMigrations':596,'appliedMigrations':596,
  'checks':{k:True for k in ['migration','migrationReplay','nonRootReadOnlyWeb','nativePublicCallback','anonymousSession']}}
 high={'VulnerabilityID':'CVE-fixture','PkgName':'fixture-os','InstalledVersion':'1.0','Severity':'HIGH'}
 os_result={'Target':'Debian GNU/Linux','Class':'os-pkgs','Type':'debian',
  'Packages':[{'ID':'fixture-os@1.0','Name':'fixture-os','Version':'1.0','PkgPath':''}],'Vulnerabilities':[high],'Secrets':[]}
 node_result={'Target':'Node packages','Class':'lang-pkgs','Type':'node-pkg','Packages':[
  {'ID':str(i),'Name':name,'Version':'1.0.0','PkgPath':file} for i,(file,name) in enumerate(m.REQUIRED.items())],
  'Vulnerabilities':[],'Secrets':[]}
 if scenario in ['nested-copy-included','same-layer-opaque-replacement']:
  node_result['Packages'].append({'ID':'extra','Name':'extra','Version':'2.0.0','PkgPath':extra})
 if scenario in ['replaced-copy','alias-whiteout-replacement']:node_result['Packages'][0]['Version']='2.0.0'
 if scenario=='alias-duplicate-coverage':node_result['Packages'].append({'ID':'invented-alias-copy','Name':'next','Version':'1.0.0','PkgPath':'calcom/node_modules/alias/package.json'})
 scan={**identity,'scanner':{'version':'0.75.0','binarySha256':m.sha(b'scanner'),'databaseSha256':m.sha(b'database'),
   'ignoredFindings':0,'skipFiles':[],'skipDirs':[],'ignoreUnfixed':False},'rawReportSha256':m.sha(b'private scan fixture'),
  'secretScope':{'filesystem':True,'allLayers':True,'configAndHistory':True,'findings':0,'exitCode':0},'releaseApproved':False,
  'report':{'SchemaVersion':2,'ArtifactType':'container_image','Metadata':{'ImageID':config_digest,'OS':{'Family':'debian','Name':'13'}},
  'Results':[os_result,node_result]}}
 db_metadata={'Version':2,'UpdatedAt':(now-dt.timedelta(hours=1)).isoformat(timespec='seconds').replace('+00:00','Z'),
  'NextUpdate':(now+dt.timedelta(hours=23)).isoformat(timespec='seconds').replace('+00:00','Z'),'DownloadedAt':timestamp}
 if scenario=='expired-database':db_metadata['NextUpdate']=(now-dt.timedelta(seconds=1)).isoformat(timespec='seconds').replace('+00:00','Z')
 if scenario=='future-database':db_metadata['UpdatedAt']=(now+dt.timedelta(hours=1)).isoformat(timespec='seconds').replace('+00:00','Z')
 if scenario=='implausible-database-expiry':db_metadata['NextUpdate']=(now+dt.timedelta(days=365)).isoformat(timespec='seconds').replace('+00:00','Z')
 if scenario=='stale-database-download':db_metadata['DownloadedAt']='2000-01-01T00:00:00Z'
 if scenario=='database-nanoseconds':
  for key in ['UpdatedAt','NextUpdate','DownloadedAt']:db_metadata[key]=db_metadata[key].replace('Z','.123456789Z')
 raw_metadata=encoded(db_metadata)
 scan['scanner']['databaseMetadata']={'raw':raw_metadata.decode(),'sha256':m.sha(raw_metadata)}
 if scenario=='database-metadata-hash':scan['scanner']['databaseMetadata']['sha256']='0'*64
 ledger={'schemaVersion':1,'sourceSha':source,'manifestDigest':manifest_digest,'releaseApproved':False,
  'entries':[{'target':os_result['Target'],'package':'fixture-os','version':'1.0','advisory':'CVE-fixture','disposition':'unwaived'}]}
 if scenario=='stale-native':container['completedAt']='2000-01-01T00:00:00Z'
 if scenario=='stale-scan':scan['completedAt']='2000-01-01T00:00:00Z'
 if scenario=='incomplete-native':container['checks']['migrationReplay']=False
 if scenario=='failed-native':container['exitCode']=1
 if scenario=='migration-count':container['appliedMigrations']=595
 if scenario=='container-origin':container['publicOrigin']='http://localhost:3000'
 if scenario=='failed-scan':scan['exitCode']=1
 if scenario=='wrong-scan-image':scan['report']['Metadata']['ImageID']='sha256:'+'0'*64
 if scenario=='missing-os':scan['report']['Results'].pop(0)
 if scenario=='duplicate-os':scan['report']['Results'].append(copy.deepcopy(os_result))
 if scenario=='missing-node-copy':node_result['Packages'].pop()
 if scenario=='duplicate-node-copy':node_result['Packages'].append(copy.deepcopy(node_result['Packages'][0]))
 if scenario=='critical':high['Severity']='CRITICAL'
 if scenario=='secrets':scan['secretScope']['findings']=1
 if scenario=='missing-secret-scope':scan['secretScope']['allLayers']=False
 if scenario=='scan-ignores':scan['scanner']['skipFiles']=['somewhere']
 if scenario=='missing-high-ledger':ledger['entries']=[]
 if scenario=='waived-high':ledger['entries'][0]['disposition']='accepted'
 if scenario=='release-approval':scan['releaseApproved']=True
 if scenario=='wrong-recipe':build['dockerfileSha256']='0'*64
 for kind,data in [('build',build),('container',container),('scan',scan),('ledger',ledger)]: (d/m.FILES[kind]).write_bytes(encoded(data))
 receipt={'schemaVersion':1,'repository':m.REPOSITORY,'sourceSha':source,'producerActor':'FixtureActor','producedAt':timestamp,
  'publicOrigin':m.ORIGIN,'artifacts':{kind:{'assetId':i+1,'bytes':(d/file).stat().st_size,'sha256':m.file_hash(d/file)} for i,(kind,file) in enumerate(m.FILES.items())}}
 if scenario=='wrong-source':receipt['sourceSha']='0'*40
 if scenario=='wrong-actor':receipt['producerActor']='OtherActor'
 if scenario=='wrong-origin':receipt['publicOrigin']='http://localhost:3000'
 if scenario=='unknown-field':receipt['extra']='fixture-only'
 if scenario=='bool-id':receipt['artifacts']['archive']['assetId']=True
 if scenario=='archive-size':receipt['artifacts']['archive']['bytes']+=1
 (d/'publication.json').write_bytes(encoded(receipt)); receipt_hash=m.file_hash(d/'publication.json')
 if scenario=='checksum':receipt_hash='0'*64
 if scenario=='duplicate-json':
  data=(d/'publication.json').read_bytes().replace(b'"schemaVersion":1',b'"schemaVersion":1,"schemaVersion":1')
  (d/'publication.json').write_bytes(data);receipt_hash=m.file_hash(d/'publication.json')
 if scenario=='extra-file':(d/'.env').write_text('fixture-only')
 if scenario=='artifact-symlink':
  saved=pathlib.Path(temp)/'saved-receipt';saved.write_bytes((d/'publication.json').read_bytes())
  (d/'publication.json').unlink();(d/'publication.json').symlink_to(saved)
 if scenario=='tamper-after-read':
  original=m.image_archive
  def changed(*args,**kwargs):
   result=original(*args,**kwargs)
   with (d/m.FILES['archive']).open('r+b') as stream:stream.write(b'x')
   return result
  m.image_archive=changed
 calls=[]
 def crane(args,**kwargs):
  calls.append(args[1]); operation=args[1]
  if operation=='auth':return response()
  if operation=='push':return response()
  if operation=='digest':
   if scenario=='auth-error':return response(1,err=b'401 unauthorized MANIFEST_UNKNOWN fixture-sensitive-body')
   if scenario=='transport-error':return response(1,err=b'timeout fixture-sensitive-body')
   if scenario=='conflict':return response(out=('sha256:'+'0'*64).encode())
   if scenario=='publish' and calls.count('digest')==1:return response(1,err=b'MANIFEST_UNKNOWN')
   if scenario=='digest-readback' and calls.count('digest')>1:return response(out=('sha256:'+'0'*64).encode())
   return response(out=manifest_digest.encode())
  if operation=='manifest':return response(out=encoded(manifest)+(b' ' if scenario=='manifest-bytes' else b''))
  if operation=='blob':
   assert args==['crane','blob',m.REGISTRY+'@'+config_digest]
   return response(out=encoded(config)+(b' ' if scenario=='config-readback' else b''))
  raise AssertionError('unexpected command')
 positive=scenario in ['admit','publish','idempotent','gzip','nested-copy-included','removed-copy','opaque-copy','replaced-copy','same-layer-opaque-replacement','fetch','safe-redirect','module-marker','source-revision','database-nanoseconds','created-annotation','created-nanoseconds',
  'package-alias','alias-next-hashed','alias-absolute','alias-chain','alias-depth40','alias-removed','alias-whiteout-replacement']
 try:
  if scenario=='cli-redaction':
   receipt['unexpected']='fixture-only-sensitive-provider-body';(d/'publication.json').write_bytes(encoded(receipt));receipt_hash=m.file_hash(d/'publication.json')
   invoked=subprocess.run(['python3','-B',str(root/'scripts/publish-enterprise-prebuilt.py'),'admit','--directory',str(d),'--source-sha',source,
    '--actor','FixtureActor','--receipt-sha256',receipt_hash],capture_output=True)
   assert invoked.returncode==1 and invoked.stdout==b'' and b'fixture-only-sensitive' not in invoked.stderr
   assert invoked.stderr==b'Prebuilt candidate refused; inspect private evidence and documented admission requirements\n'
   raise m.Refused('expected CLI refusal')
  elif scenario.startswith('fetch'):
   payloads={99:('publication.json',(d/'publication.json').read_bytes())}
   for kind,asset in receipt['artifacts'].items():payloads[asset['assetId']]=(m.FILES[kind],(d/m.FILES[kind]).read_bytes())
   release={'id':42,'draft':False,'prerelease':True,'tag_name':'cal-candidate-'+source,'target_commitish':source,
     'author':{'login':'FixtureActor'},'assets':[{'id':asset,'name':name,'size':len(data),'state':'uploaded'} for asset,(name,data) in payloads.items()]}
   if scenario=='fetch-draft':release['draft']=True
   if scenario=='fetch-source':release['target_commitish']='0'*40
   if scenario=='fetch-author':release['author']['login']='OtherActor'
   if scenario=='fetch-extra-asset':release['assets'].append({'id':100,'name':'extra','size':1,'state':'uploaded'})
   if scenario=='fetch-wrong-name':release['assets'][1]['name']='../outside'
   requested=[]
   def transport(endpoint,output,limit,token):
    requested.append(endpoint)
    assert endpoint.startswith('https://api.github.com/repos/'+m.REPOSITORY+'/releases/')
    if output is None:return release
    asset=int(endpoint.rsplit('/',1)[1]);data=payloads[asset][1]
    if scenario=='fetch-corrupt' and asset==1:data=b'x'*len(data)
    output.write_bytes(data)
   m.download=transport
   downloaded=pathlib.Path(temp)/'downloaded'
   m.fetch(downloaded,42,99,receipt_hash,source,'FixtureActor')
   result=m.admit(downloaded,receipt_hash,source,'FixtureActor',root,now=now)
   assert len(requested)==7
  elif scenario in ['safe-redirect','host-redirect','http-redirect','port-redirect']:
   request=m.urllib.request.Request('https://api.github.com/repos/'+m.REPOSITORY+'/releases/assets/1',headers={'Authorization':'Bearer fixture-only'})
   target={'safe-redirect':'https://release-assets.githubusercontent.com/fixture','host-redirect':'https://other.example.test/fixture',
           'http-redirect':'http://release-assets.githubusercontent.com/fixture','port-redirect':'https://release-assets.githubusercontent.com:8443/fixture'}[scenario]
   redirected=m.SafeRedirect().redirect_request(request,None,302,'',{},target)
   assert not redirected.has_header('Authorization')
   result=m.admit(d,receipt_hash,source,'FixtureActor',root,now=now)
  elif scenario in ['publish','idempotent','auth-error','transport-error','conflict','digest-readback','config-readback','manifest-bytes','wrong-workflow','source-revision']:
   os.environ.update(GITHUB_ACTIONS='true',GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_REPOSITORY=m.REPOSITORY,
    GITHUB_ACTOR='FixtureActor',GITHUB_SHA=publisher_sha,GITHUB_RUN_ID='1',GITHUB_TOKEN='fixture-only-never-output',
    GITHUB_WORKFLOW_REF=m.REPOSITORY+'/.github/workflows/build-fork-image.yml@refs/heads/fixture')
   if scenario=='wrong-workflow':os.environ['GITHUB_REPOSITORY']='Other/Repo'
   result=m.publish(d,receipt_hash,source,'FixtureActor',checkout,run=crane)
   assert ('push' in calls)==(scenario=='publish')
  else:result=m.admit(d,receipt_hash,source,'FixtureActor',checkout,now=now)
  assert positive, 'invalid bundle admitted'
  assert result['releaseApproved'] is False and result['manifestDigest']==manifest_digest and result['configDigest']==config_digest
  assert result['counts']=={'HIGH':1} and result['tag']=='candidate-'+source+'-'+manifest_digest[7:]
 except (m.Refused,gzip.BadGzipFile,EOFError):
  assert not positive, 'valid fixture refused'
  if scenario in ['auth-error','transport-error','conflict','wrong-workflow']:assert 'push' not in calls
 print('fixture-control-passed')
`;
for (const scenario of [
  "admit",
  "publish",
  "idempotent",
  "wrong-platform",
  "root-user",
  "wrong-entrypoint",
  "wrong-label",
  "secret-env",
  "wrong-shipped-build",
  "wrong-shipped-recipe",
  "missing-shipped-manifest",
  "whiteout",
  "index-platform",
  "multiple-platforms",
  "created-annotation",
  "created-nanoseconds",
  "created-invalid-date",
  "created-invalid-leap",
  "created-invalid-hour",
  "created-non-utc",
  "created-missing-zone",
  "created-too-precise",
  "created-overlong",
  "created-wrong-type",
  "created-unknown-annotation",
  "created-extra-annotation",
  "created-ref-name",
  "created-empty-annotations",
  "created-annotations-type",
  "created-unknown-descriptor-key",
  "config-created-annotation",
  "layer-created-annotation",
  "corrupt-blob",
  "missing-blob",
  "unreferenced-blob",
  "traversal",
  "duplicate-member",
  "symlink",
  "device",
  "stale-native",
  "stale-scan",
  "incomplete-native",
  "failed-native",
  "migration-count",
  "container-origin",
  "failed-scan",
  "wrong-scan-image",
  "missing-os",
  "duplicate-os",
  "missing-node-copy",
  "duplicate-node-copy",
  "critical",
  "secrets",
  "missing-secret-scope",
  "scan-ignores",
  "missing-high-ledger",
  "waived-high",
  "release-approval",
  "wrong-recipe",
  "wrong-source",
  "wrong-actor",
  "wrong-origin",
  "unknown-field",
  "bool-id",
  "archive-size",
  "checksum",
  "duplicate-json",
  "extra-file",
  "auth-error",
  "transport-error",
  "conflict",
  "digest-readback",
  "config-readback",
  "wrong-workflow",
  "manifest-bytes",
  "gzip",
  "corrupt-gzip",
  "gzip-bound",
  "gzip-deadline",
  "duplicate-package",
  "package-alias",
  "alias-next-hashed",
  "alias-absolute",
  "alias-chain",
  "alias-depth40",
  "alias-depth41",
  "alias-cycle",
  "alias-escape",
  "alias-dangling",
  "alias-file",
  "alias-hardlink",
  "alias-package-json",
  "alias-target-marker",
  "alias-outside-inventory",
  "alias-componentwise-escape",
  "alias-replaced-ancestor",
  "alias-whiteout-target",
  "alias-opaque-target",
  "alias-removed",
  "alias-whiteout-replacement",
  "alias-duplicate-coverage",
  "alias-dpkg-ancestor",
  "nested-copy-missing",
  "nested-copy-included",
  "removed-copy",
  "opaque-copy",
  "replaced-copy",
  "replaced-copy-old-scan",
  "same-layer-opaque-replacement",
  "artifact-symlink",
  "tamper-after-read",
  "fetch",
  "fetch-draft",
  "fetch-source",
  "fetch-author",
  "fetch-extra-asset",
  "fetch-wrong-name",
  "fetch-corrupt",
  "safe-redirect",
  "host-redirect",
  "http-redirect",
  "port-redirect",
  "ambiguous-package",
  "module-marker",
  "cli-redaction",
  "source-revision",
  "tree-as-source",
  "expired-database",
  "future-database",
  "implausible-database-expiry",
  "stale-database-download",
  "database-nanoseconds",
  "database-metadata-hash",
]) {
  test(`prebuilt publisher ${scenario} uses actual source admission with explicit native/provider fixtures`, () => {
    const { execFileSync } = require("node:child_process");
    const output = execFileSync(
      "python3",
      ["-B", "-c", prebuiltFixture, path.resolve(__dirname, "../.."), scenario],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20000,
      }
    );
    assert.equal(output.trim(), "fixture-control-passed");
  });
}

test("existing publisher workflow keeps authority and prebuilt publication cannot reach legacy builds", async () => {
  const workflow = await fs.readFile(
    path.resolve(__dirname, "../../.github/workflows/build-fork-image.yml"),
    "utf8"
  );
  assert.match(workflow, /runs-on: mereka-k8s-heavy-builders/);
  assert.match(workflow, /timeout-minutes: 60/);
  assert.match(workflow, /permissions:\n {2}contents: read\n {2}packages: write/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /\$TAG_OVERRIDE" != candidate-\*/);
  for (const step of [
    "Compute image tags",
    "Set up Docker Buildx",
    "Log in to GHCR",
    "Build and push",
    "Summary",
  ]) {
    assert.ok(workflow.includes(`- name: ${step}\n        if: inputs.mode != 'prebuilt'`));
  }
  for (const step of [
    "Admit exact prebuilt candidate",
    "Prepare pinned prebuilt publisher",
    "Publish and read back exact candidate",
  ]) {
    assert.ok(
      workflow.includes(
        `- name: ${step}\n        if: github.event_name == 'workflow_dispatch' && inputs.mode == 'prebuilt'`
      )
    );
  }
  assert.doesNotMatch(workflow, /\$\{\{ inputs.tag_override \}\}"/);
});
