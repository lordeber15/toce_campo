import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { validatorCompiler,serializerCompiler } from '@fastify/type-provider-zod';
import { canonicalFormJson } from '@toce/shared';
import { randomUUID } from 'node:crypto';
// Isolated HTTP contract test; no live credentials or database connections.
Object.assign(process.env,{NODE_ENV:'test',DB_HOST:'localhost',DB_PORT:'65432',DB_USER:'test',DB_PASSWORD:'test',DB_NAME:'test',JWT_ACCESS_SECRET:'test-only-access-key-longer-than-32-characters',JWT_REFRESH_SECRET:'test-only-refresh-key-longer-than-32-characters',MINIO_ROOT_USER:'test',MINIO_ROOT_PASSWORD:'test'});
const {default:routes}=await import('../src/routes/formImport.js');
const catalog=JSON.parse((await readFile(new URL('./fixtures/forms/catalog.json',import.meta.url),'utf8')).replace(/^\uFEFF/,'')) as Record<string,string>[];
let targets=catalog.map((c)=>({id:randomUUID(),code:c['Código'],specialtyCode:c.Especialidad,specialtyName:c.Especialidad,formSchema:{fields:[]} as unknown}));
let audits=0,snapshotWrites=0,fail=false;
const db={
  select:()=>({from:()=>({innerJoin:()=>({where:()=>({orderBy:async()=>structuredClone(targets)})})})}),
  execute:async()=>{snapshotWrites++;return{rows:[]};},
  update:()=>({set:(value:{formSchema:unknown})=>({where:async()=>{if(fail)throw new Error('simulated failure');const s=value.formSchema as {methodCode:string};const t=targets.find((x)=>x.code===s.methodCode)!;t.formSchema=structuredClone(value.formSchema);}})}),
  insert:()=>({values:async()=>{audits++;}}),
  transaction:async<T>(fn:(tx:unknown)=>Promise<T>)=>{const before=structuredClone(targets),a=audits,s=snapshotWrites;try{return await fn(db);}catch(e){targets=before;audits=a;snapshotWrites=s;throw e;}},
};
const app=Fastify({bodyLimit:10*1024*1024});
app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);
app.decorate('db',db);app.decorate('requireRoles',()=>async(req:{headers:Record<string,string>},reply:{code:(n:number)=>{send:(v:unknown)=>unknown}})=>{if(req.headers.authorization!=='test-admin')return reply.code(403).send({error:'Forbidden'});});
await app.register(routes,{prefix:'/api'});
const fileBase64=(await readFile(new URL('./fixtures/forms/TOCE_24_metodos.xlsx',import.meta.url))).toString('base64');
const post=(path:string,payload:unknown,admin=true)=>app.inject({method:'POST',url:'/api/import/forms/'+path,headers:admin?{authorization:'test-admin'}:{},payload});
assert.equal((await post('validate',{fileBase64},false)).statusCode,403);
const validation=await post('validate',{fileBase64});assert.equal(validation.statusCode,200);const preview=validation.json();
assert.equal(preview.items.length,24);assert.equal(audits,0);
assert.equal((await post('commit',{fileBase64,fingerprint:preview.fingerprint,compatibleMobileConfirmed:false})).statusCode,400);
assert.equal((await post('commit',{fileBase64,fingerprint:'0'.repeat(64),compatibleMobileConfirmed:true})).statusCode,409);
fail=true;const before=canonicalFormJson(targets);
assert.equal((await post('commit',{fileBase64,fingerprint:preview.fingerprint,compatibleMobileConfirmed:true})).statusCode,500);
assert.equal(canonicalFormJson(targets),before);assert.equal(audits,0);fail=false;
assert.equal((await post('commit',{fileBase64,fingerprint:preview.fingerprint,compatibleMobileConfirmed:true})).json().updated,24);assert.equal(audits,24);
const second=(await post('validate',{fileBase64})).json();
assert.equal((await post('commit',{fileBase64,fingerprint:second.fingerprint,compatibleMobileConfirmed:true})).json().updated,0);
assert.equal(audits,24);
await app.close();console.log('PASS: API auth, preview-only, confirmation, stale preview, rollback and idempotent commit (transactional test double).');
