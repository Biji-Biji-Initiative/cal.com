// SPDX-License-Identifier: MIT
// Production code and native crypto; the transaction engine is a test double,
// not PostgreSQL, Prisma-generated query validation, or Nest runtime acceptance.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const feature = "packages/features/community-enterprise/";
function load(file, dependencies = {}) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const output = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true, experimentalDecorators: true,
  } });
  assert.deepEqual(output.diagnostics, []);
  const module = { exports: {} };
  new Function("require", "module", "exports", output.outputText)((name) => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Missing test dependency ${name} from ${file}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const keyCrypto = load("packages/features/api-keys-legacy/api-keys/lib/apiKeys.ts", { "node:crypto": require("node:crypto") });
const inputPolicy = load(`${feature}api-keys/ApiKeyInput.ts`);
const policy = load(`${feature}authorization/PermissionPolicy.ts`);
const { PermissionCheckService } = load(`${feature}authorization/PermissionCheckService.ts`, {
  "./PermissionPolicy": policy, "@calcom/prisma": { __esModule: true, default: null },
});
class ErrorWithCode extends Error { constructor(code, message) { super(message); this.code = code; } }
const lifecycle = load(`${feature}api-keys/ApiKeyLifecycle.ts`, {
  "node:crypto": require("node:crypto"),
  "@calcom/features/api-keys-legacy/api-keys/lib/apiKeys": keyCrypto,
  "@calcom/features/community-enterprise/authorization/PermissionCheckService": { PermissionCheckService },
  "@calcom/lib/errorCodes": { ErrorCode: { Forbidden: "forbidden_error", BadRequest: "bad_request_error" } },
  "@calcom/lib/errors": { ErrorWithCode }, "./ApiKeyInput": inputPolicy,
});
const { createApiKey, rotateApiKey } = lifecycle;
function fixture() {
  const member = (teamId, role = "MEMBER") => ({ id: teamId, userId: 7, teamId, role, accepted: true, customRoleId: null, customRole: null });
  const f = { users: [{ id: 7, locked: false }, { id: 9, locked: false }],
    teams: [{ id: 100, isOrganization: true, parentId: null }, { id: 200, isOrganization: true, parentId: null },
      { id: 10, isOrganization: false, parentId: 100 }, { id: 20, isOrganization: false, parentId: 200 },
      { id: 30, isOrganization: false, parentId: null }],
    memberships: [member(100), member(10,"ADMIN"), member(30,"OWNER")],
    keys: [], audit: [], attempts: 0, calls: [], serial: Promise.resolve(), retry: 0,
    failAudit: false, failCreate: false, failDelete: false, failCommit: false, omitDelete: false };
  const keys = (rows, where) => rows.filter((key) => Object.entries(where).every(([name,value]) => key[name] === value));
  f.db = { async $transaction(callback, options) {
    // Serialize only this synthetic fixture; live concurrency still needs the
    // repository's database/E2E lane before this candidate is promoted.
    let release; const prior = f.serial; f.serial = new Promise((resolve) => { release = resolve; }); await prior;
    f.attempts++; f.calls.push(["transaction",options]);
    const draft = { keys: structuredClone(f.keys), audit: structuredClone(f.audit) };
    const tx = {
      user: { async findUnique(query) { f.calls.push(["user",query]); return f.users.find((u) => u.id === query.where.id) ?? null; } },
      membership: {
        async findFirst({where}) { return f.memberships.find((m) => m.userId===where.userId && m.teamId===where.teamId && m.accepted && m.customRoleId===null && where.role.in.includes(m.role)) ?? null; },
        async findMany({where}) { return f.memberships.filter((m) => m.userId===where.userId); },
      },
      team: {
        async findMany({where}) { return f.teams.filter((t) => where.id ? where.id.in.includes(t.id) : where.parentId.in.includes(t.parentId)); },
        async findUnique({where}) { return f.teams.find((t) => t.id===where.id) ?? null; },
      },
      apiKey: {
        async findUnique(query) { f.calls.push(["key-read",query]); return keys(draft.keys,query.where)[0] ?? null; },
        async create({data,select}) { f.calls.push(["key-create",{data,select}]); if(f.failCreate)throw new Error("create failed"); draft.keys.push(structuredClone(data)); return {id:data.id}; },
        async deleteMany({where}) { f.calls.push(["key-delete",where]); if(f.failDelete)throw new Error("delete failed"); if(f.omitDelete)return {count:0}; const rows=keys(draft.keys,where); draft.keys=draft.keys.filter((k)=>!rows.includes(k)); return {count:rows.length}; },
      },
      enterpriseAuditEvent: { async create({data}) { f.calls.push(["audit",data]); if(f.failAudit)throw new Error("audit failed"); draft.audit.push(structuredClone(data)); return {id:data.id}; } },
    };
    try {
      const result=await callback(tx);
      if(f.retry>0){f.retry--;if(f.onConflict)f.onConflict();throw Object.assign(new Error("conflict"),{code:"P2034"});}
      if(f.failCommit)throw new Error("commit failed");
      f.keys=draft.keys;f.audit=draft.audit;return result;
    } finally {release();}
  } };
  f.seed = (extra={}) => {
    const [hashedKey,raw]=keyCrypto.generateUniqueAPIKey();
    f.keys.push({id:"old",userId:7,teamId:10,appId:"fixture-app",note:"private note",expiresAt:null,hashedKey,...extra});
    return `test_${raw}`;
  };
  return f;
}
const expires = () => new Date(Date.now()+60000);
const denied = (error) => error.code === "forbidden_error";
test("creation uses retained crypto, stores only hash, and returns a secret after commit",async()=>{
  const f=fixture();const key=await createApiKey(f.db,7,{teamId:10,expiresAt:expires()},"test_");
  assert.match(key,/^test_[a-f0-9]{32}$/);assert.equal(f.keys[0].hashedKey,keyCrypto.hashAPIKey(key.slice(5)));
  assert.ok(!JSON.stringify(f.keys).includes(key.slice(5)));assert.ok(!JSON.stringify(f.audit).includes(key.slice(5)));
  assert.equal(f.audit.length,1);assert.equal(f.audit[0].organizationId,100);assert.equal(f.audit[0].action,"api_key.created");
});
test("success uses a single serializable transaction and narrow key result",async()=>{
  const f=fixture();await createApiKey(f.db,7,{neverExpires:true});
  assert.deepEqual(f.calls[0],["transaction",{isolationLevel:"Serializable",maxWait:5000,timeout:10000}]);
  assert.deepEqual(f.calls.find(([kind])=>kind==="key-create")[1].select,{id:true});
});
test("personal keys stay personal instead of inventing an organization audit scope",async()=>{
  const f=fixture();await createApiKey(f.db,7,{});assert.equal(f.keys[0].teamId,null);assert.equal(f.audit.length,0);
});
test("standalone team keeps existing team boundary without fictitious organization",async()=>{
  const f=fixture();await createApiKey(f.db,7,{teamId:30});assert.equal(f.keys[0].teamId,30);assert.equal(f.audit.length,0);
});
for(const [name,change] of [
  ["locked actor",f=>{f.users[0].locked=true;}], ["deleted actor",f=>{f.users.shift();}],
  ["pending team member",f=>{f.memberships[1].accepted=false;}], ["ordinary member",f=>{f.memberships[1].role="MEMBER";}],
  ["pending parent membership",f=>{f.memberships[0].accepted=false;}], ["removed parent membership",f=>{f.memberships.shift();}],
  ["foreign administrator",f=>{f.memberships=[{userId:7,teamId:200,accepted:true,role:"OWNER",customRoleId:null}];}],
  ["global role without team authority",f=>{f.users[0].role="ADMIN";f.memberships=[];}],
  ["custom role cannot mint an unrestricted legacy key",f=>{f.memberships[1].customRoleId="custom";f.memberships[1].customRole={id:"custom",teamId:10,permissions:[{resource:"apiKey",action:"manage"}]};}],
  ["deleted team",f=>{f.teams=f.teams.filter(t=>t.id!==10);}],
])test(`create and rotate reject ${name}`,async()=>{
  const f=fixture();const old=f.seed();change(f);
  await assert.rejects(createApiKey(f.db,7,{teamId:10}),denied);
  await assert.rejects(rotateApiKey(f.db,7,old,{},"test_"),denied);
  assert.equal(f.keys.length,1);assert.equal(f.keys[0].id,"old");assert.equal(f.audit.length,0);
});
for(const userId of [0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])test(`invalid actor ${userId} denied`,async()=>{
  const f=fixture();await assert.rejects(createApiKey(f.db,userId,{}),denied);assert.equal(f.keys.length,0);
});
for(const teamId of [0,-1,NaN,Infinity,1.5,null])test(`invalid team ${teamId} does not create personal key`,async()=>{
  const f=fixture();await assert.rejects(createApiKey(f.db,7,{teamId}));assert.equal(f.keys.length,0);
});
test("metadata cannot override generated key identity or owner",async()=>{
  const f=fixture();await createApiKey(f.db,7,{neverExpires:true,userId:9,id:"chosen",hashedKey:"chosen"});
  assert.equal(f.keys[0].userId,7);assert.notEqual(f.keys[0].id,"chosen");assert.notEqual(f.keys[0].hashedKey,"chosen");
});
test("rotation consumes exactly the actor's old key and preserves owner/team/app/note",async()=>{
  const f=fixture();const old=f.seed();const result=await rotateApiKey(f.db,7,old,{teamId:20,userId:9,appId:"foreign",note:"changed"},"test_");
  assert.notEqual(result,old);assert.equal(f.keys.length,1);assert.notEqual(f.keys[0].id,"old");
  assert.equal(f.keys[0].userId,7);assert.equal(f.keys[0].teamId,10);assert.equal(f.keys[0].appId,"fixture-app");assert.equal(f.keys[0].note,"private note");
  assert.equal(f.audit[0].action,"api_key.rotated");assert.equal(f.audit[0].details.previousKeyId,"old");
  assert.ok(!JSON.stringify(f.audit).includes("private note"));
  await assert.rejects(rotateApiKey(f.db,7,old,{},"test_"),denied);
});
test("another user cannot rotate the key even with its plaintext",async()=>{
  const f=fixture();const old=f.seed();await assert.rejects(rotateApiKey(f.db,9,old,{},"test_"),denied);assert.equal(f.keys[0].id,"old");
});
test("expired key and invalid stored expiration cannot be renewed",async()=>{
  for(const expiresAt of [new Date(Date.now()-1),new Date("invalid")]){
    const f=fixture();const old=f.seed({expiresAt});await assert.rejects(rotateApiKey(f.db,7,old,{},"test_"),denied);assert.equal(f.keys.length,1);
  }
});
for(const point of ["failCreate","failAudit","failDelete","failCommit","omitDelete"])test(`rotation rolls back on ${point}`,async()=>{
  const f=fixture();const old=f.seed();f[point]=true;
  await assert.rejects(rotateApiKey(f.db,7,old,{},"test_"));assert.equal(f.keys.length,1);assert.equal(f.keys[0].id,"old");assert.equal(f.audit.length,0);
});
test("a serializable retry rechecks authority, not just the final write",async()=>{
  const f=fixture();const old=f.seed();f.retry=1;f.onConflict=()=>{f.memberships[1].accepted=false;};
  await assert.rejects(rotateApiKey(f.db,7,old,{},"test_"),denied);assert.equal(f.attempts,2);assert.equal(f.keys[0].id,"old");
});
test("bounded transaction retry yields only one committed replacement and audit",async()=>{
  const f=fixture();const old=f.seed();f.retry=2;const key=await rotateApiKey(f.db,7,old,{},"test_");
  assert.equal(f.attempts,3);assert.equal(f.keys.length,1);assert.equal(f.audit.length,1);assert.equal(f.keys[0].hashedKey,keyCrypto.hashAPIKey(key.slice(5)));
});
test("retry exhaustion preserves the prior committed key",async()=>{
  const f=fixture();const old=f.seed();f.retry=4;await assert.rejects(rotateApiKey(f.db,7,old,{},"test_"));assert.equal(f.attempts,3);assert.equal(f.keys[0].id,"old");
});
test("two calls using one prior key do not both succeed in the serialized fixture",async()=>{
  const f=fixture();const old=f.seed();const result=await Promise.allSettled([rotateApiKey(f.db,7,old,{},"test_"),rotateApiKey(f.db,7,old,{},"test_")]);
  assert.equal(result.filter(r=>r.status==="fulfilled").length,1);assert.equal(f.keys.length,1);assert.equal(f.audit.length,1);
});
for(const input of [{expiresAt:null},{expiresAt:new Date(0)},{expiresAt:new Date("invalid")},{neverExpires:"true"},{note:3},{appId:{}}])test(`invalid input ${JSON.stringify(input)} denied`,()=>{
  assert.throws(()=>inputPolicy.normalizeApiKeyInput(input,1000));
});
test("explicit nonexpiry overrides legacy callers' computed expiration",()=>{
  assert.equal(inputPolicy.normalizeApiKeyInput({neverExpires:true,expiresAt:new Date(0)},1000).expiresAt,null);
});
test("expiry defaults to 30 days and clones rather than mutating date input",()=>{
  assert.equal(inputPolicy.normalizeApiKeyInput({},1000).expiresAt.getTime(),1000+30*86400000);
  const date=new Date(2000);const result=inputPolicy.normalizeApiKeyInput({expiresAt:date},1000);assert.notEqual(result.expiresAt,date);assert.equal(date.getTime(),2000);
});
for(const prefix of ["", "prefix space", "bad\n", null])test(`invalid prefix ${JSON.stringify(prefix)} rejected before write`,async()=>{
  const f=fixture();await assert.rejects(createApiKey(f.db,7,{},prefix));assert.equal(f.attempts,0);
});
for(const value of ["other_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","test_","test_a\nb","Basic anything"])test("malformed prior key cannot enter rotation transaction",async()=>{
  const f=fixture();await assert.rejects(rotateApiKey(f.db,7,value,{},"test_"),denied);assert.equal(f.attempts,0);
});

class HttpError extends Error {}
class BadRequestException extends HttpError {}
class ForbiddenException extends HttpError {}
class UnauthorizedException extends HttpError {}
const Nest = { Injectable: () => (klass) => klass, BadRequestException, ForbiddenException, UnauthorizedException };
const credentialPolicy = load("apps/api/v2/src/modules/auth/services/credential-policy.ts");
const { ApiKeysService } = load("apps/api/v2/src/modules/api-keys/services/api-keys.service.ts", {
  "@/lib/enums/auth-methods": { AuthMethods: { API_KEY: "API_KEY" } },
  "@/modules/auth/services/credential-policy": credentialPolicy,
  "@/modules/prisma/prisma-write.service": {}, "@nestjs/common": Nest, "@nestjs/config": {},
  "@calcom/platform-libraries": lifecycle,
});
function service(f) { return new ApiKeysService({prisma:f.db},{get:()=>"test_"}); }
test("actual API v2 service creates and rotates with its injected primary client",async()=>{
  const f=fixture();const s=service(f);
  const first=await s.createApiKey(7,{teamId:10,note:"fixture",apiKeyDaysValid:1});
  const second=await s.refreshApiKey(7,first,{apiKeyDaysValid:2});
  assert.notEqual(first,second);assert.equal(f.keys.length,1);assert.equal(f.audit.length,2);
  assert.equal(f.keys[0].note,"fixture");assert.equal(f.keys[0].teamId,10);
});
for(const input of [{apiKeyDaysValid:0},{apiKeyDaysValid:1.5},{apiKeyDaysValid:-1},{apiKeyDaysValid:Infinity},{apiKeyDaysValid:1,apiKeyNeverExpires:true},{apiKeyNeverExpires:"true"},{apiKeyDaysValid:Number.MAX_SAFE_INTEGER}])test("API service rejects invalid lifetime before database access",async()=>{
  const f=fixture();await assert.rejects(service(f).createApiKey(7,input),BadRequestException);assert.equal(f.attempts,0);
});
test("actual API service maps only recognized domain errors to HTTP errors",async()=>{
  const f=fixture();f.users[0].locked=true;
  await assert.rejects(service(f).createApiKey(7,{}),ForbiddenException);
  f.users[0].locked=false;f.failCommit=true;
  await assert.rejects(service(f).createApiKey(7,{}),error=>error.message==="commit failed" && !(error instanceof HttpError));
});
test("actual API service uses the validated Bearer parser and refuses other authentication methods",async()=>{
  const f=fixture();const s=service(f);
  assert.equal(await s.getRequestApiKey({authMethod:"API_KEY",get:()=>"bearer test_aaaaaaaaaaaaaaaa"}),"test_aaaaaaaaaaaaaaaa");
  await assert.rejects(s.getRequestApiKey({authMethod:"NEXT_AUTH",get:()=>"Bearer test_aaaaaaaaaaaaaaaa"}),UnauthorizedException);
  await assert.rejects(s.getRequestApiKey({authMethod:"API_KEY",get:()=>"Basic test_aaaaaaaaaaaaaaaa"}),UnauthorizedException);
});
test("existing web handler reuses the same lifecycle and maps errors without plaintext logging",async()=>{
  const f=fixture();class TRPCError extends Error {constructor(input){super(input.code);this.code=input.code;}}
  const {createHandler}=load("packages/trpc/server/routers/viewer/apiKeys/create.handler.ts",{
    "@calcom/features/community-enterprise/api-keys/ApiKeyLifecycle":lifecycle,
    "@calcom/prisma":{__esModule:true,default:f.db},"@trpc/server":{TRPCError},
  });
  const key=await createHandler({ctx:{user:{id:7}},input:{teamId:10,neverExpires:true}});
  assert.match(key,/^cal_/);assert.equal(f.keys[0].expiresAt,null);
  f.users[0].locked=true;await assert.rejects(createHandler({ctx:{user:{id:7}},input:{}}),error=>error.code==="FORBIDDEN");
});
test("credential lookup uses primary state even when read replica retains the old key",async()=>{
  const {ApiKeysRepository}=load("apps/api/v2/src/modules/api-keys/api-keys-repository.ts",{
    "@/modules/prisma/prisma-read.service":{},"@/modules/prisma/prisma-write.service":{},"@nestjs/common":Nest,
  });
  let replicaReads=0;let primaryReads=0;
  const repo=new ApiKeysRepository({prisma:{apiKey:{findUnique:async()=>{replicaReads++;return {id:"revoked"};}}}},
    {prisma:{apiKey:{findUnique:async()=>{primaryReads++;return null;}}}});
  assert.equal(await repo.getApiKeyFromHash("fixture"),null);assert.equal(replicaReads,0);assert.equal(primaryReads,1);
});
test("platform export retains the handler name and routes API operations to the same lifecycle",()=>{
  const file="packages/platform/libraries/index.ts";const ast=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),"utf8"),ts.ScriptTarget.Latest,true);
  const exports=new Map(ast.statements.filter(ts.isExportDeclaration).filter(n=>n.moduleSpecifier&&n.exportClause&&ts.isNamedExports(n.exportClause))
    .flatMap(n=>n.exportClause.elements.map(e=>[e.name.text,n.moduleSpecifier.text])));
  assert.equal(exports.get("createApiKey"),"@calcom/features/community-enterprise/api-keys/ApiKeyLifecycle");
  assert.equal(exports.get("rotateApiKey"),exports.get("createApiKey"));
  assert.equal(exports.get("createApiKeyHandler"),"@calcom/trpc/server/routers/viewer/apiKeys/create.handler");
  assert.ok(!ast.statements.some(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="createApiKeyHandler"));
});

test("invalid replacement expiry leaves the original live key untouched",async()=>{
  const f=fixture();const old=f.seed();await assert.rejects(rotateApiKey(f.db,7,old,{expiresAt:new Date(0)},"test_"));
  assert.equal(f.keys[0].id,"old");assert.equal(f.calls.some(([kind])=>kind==="key-delete"),false);
});
test("root-organization key audit points to that organization",async()=>{
  const f=fixture();f.memberships[0].role="OWNER";await createApiKey(f.db,7,{teamId:100});
  assert.equal(f.audit[0].organizationId,100);assert.equal(f.audit[0].details.teamId,100);
});
test("the standard enterprise suite includes this regression file exactly once",()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
  assert.equal(manifest.scripts["test:community-enterprise"].split("tests/community-enterprise/api-key-lifecycle.test.cjs").length,2);
});
test("another accepted team administrator cannot rotate somebody else's key",async()=>{
  const f=fixture();const old=f.seed();f.memberships.push(
    {userId:9,teamId:100,accepted:true,customRoleId:null,role:"MEMBER"},
    {userId:9,teamId:10,accepted:true,customRoleId:null,role:"ADMIN"});
  await assert.rejects(rotateApiKey(f.db,9,old,{},"test_"),denied);assert.equal(f.keys[0].userId,7);
});
