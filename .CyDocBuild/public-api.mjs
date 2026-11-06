import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {importApi} from "cydoc/api-import";
import {extractComments} from "cydoc/extract";
export const slug=value=>String(value).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const fence="~~~";
export const front=(id,title,description,parent,section,order,body,tracking)=>"---\nid: "+id+"\ntitle: "+title+"\ndescription: "+description+"\nsection: "+section+"\norder: "+order+"\n"+(id.startsWith("rest-")||id==="sdk-client"?"kind: api\n":"")+(parent?"parent: "+parent+"\n":"")+tracking+"\n---\n\n"+body.trim()+"\n";
export async function writePair(work,id,titles,descriptions,parent,order,bodies,section=["Developers","Développement"]){
 const revision=createHash("sha256").update(titles[0]+descriptions[0]+bodies[0]).digest("hex").slice(0,12);
 for(const [index,locale]of ["en","fr"].entries()){
  await fs.mkdir(path.join(work,"manual",locale,"reference"),{recursive:true});
  await fs.writeFile(path.join(work,"manual",locale,"reference",id+".md"),front(id,titles[index],descriptions[index],parent,section[index],order,bodies[index],index?"sourceRevision: "+revision:"revision: "+revision));
 }
}
const groups={
 system:["Service status","État du service"],auth:["Accounts and sessions","Comptes et sessions"],
 agents:["Agents and work calls","Agents et appels de travail"],projects:["Projects and labels","Projets et labels"],
 tasks:["Tasks and relationships","Tâches et relations"],media:["Attachments and uploads","Pièces jointes et envois"],
 plugins:["Plugins and annotations","Plugins et annotations"],migration:["Migration","Migration"],events:["Activity and synchronization","Activité et synchronisation"]
};
const classify=route=>/migrations/.test(route)?"migration":/plugins|external-references/.test(route)?"plugins":/attachments|attachment-uploads|media-previews/.test(route)?"media":/\/agents?\b/.test(route)?"agents":/health|openapi/.test(route)?"system":/sessions?|bootstrap|account|auth|tokens|local\/session/.test(route)?"auth":/tasks|task-page|task-options|task-hierarchy/.test(route)?"tasks":/projects|members|invitations/.test(route)?"projects":"events";
const fieldText=[
 ["Vide hors création de session","Empty except when creating a session."],
 ["Token temporaire lié au cookie MFA, à conserver en mémoire de page et jamais dans l’URL","Temporary token bound to the MFA cookie. Keep it in page memory, never in a URL."],
 ["Clé Base32 affichée uniquement pendant l’enrôlement TOTP","Base32 key shown only during TOTP enrollment."],
 ["URI otpauth pour le QR code généré localement","otpauth URI for a locally generated QR code."],
 ["Adresse e-mail masquée","Masked email address."],
 ["Montré une seule fois. Format cytask_pat_…","Shown only once; cytask_pat_… format."],
 ["Type observé par le serveur ; c'est lui qui est servi","Server-detected content type, used when serving the file."],
 ["Largeur en pixels des images et des vidéos","Width of an image or video in pixels."],
 ["Durée en secondes, relevée dans l'en-tête des vidéos MP4 et WebM","Duration in seconds from the MP4 or WebM header."],
 ["Adresse HTTPS *.atlassian.net pour Jira Cloud","HTTPS *.atlassian.net address for Jira Cloud."],
 ["Dossier parent optionnel, limité à cinq niveaux.","Optional parent folder, limited to five levels."],
 ["UUID du dernier événement complètement traité par le client.","UUID of the last event completely processed by the client."],
 ["all, unassigned ou identifiant utilisateur UUID.","all, unassigned or a user UUID."],
 ["all, none ou identifiant de label UUID.","all, none or a label UUID."],
 ["Valeur JavaScript Date.getTimezoneOffset(), utilisée pour les filtres today et week.","JavaScript Date.getTimezoneOffset(), used by today and week filters."]
];
function translated(value,fr){if(!value)return "";const entry=fieldText.find(row=>row[0]===value);if(!entry)throw Error("Translate public field description: "+value);return fr?entry[0]:entry[1];}
const quoted=value=>String(value??"").replaceAll("|","\\|").replace(/\r?\n/g," ");
export async function generateApi(work,root){
 const spec=JSON.parse(await fs.readFile(path.join(root,"apps/server/src/CyTask.Api/Contracts/openapi.json"),"utf8"));
 const titles=JSON.parse(await fs.readFile(path.join(work,"api-titles.json"),"utf8")),behavior=JSON.parse(await fs.readFile(path.join(work,"api-behavior.json"),"utf8"));
 const deref=value=>value?.$ref?value.$ref.split("/").slice(1).reduce((object,key)=>object?.[key],spec):value;
 const type=s=>{if(!s)return "—";if(s.$ref)return s.$ref.split("/").at(-1);if(s.oneOf||s.anyOf)return (s.oneOf??s.anyOf).map(type).join(" | ");if(s.type==="array")return type(s.items)+"[]";return (Array.isArray(s.type)?s.type.join(" | "):s.type??"object")+(s.format?" ("+s.format+")":"");};
 const table=(schema,fr)=>{
  schema=deref(schema);if(!schema)return fr?"Aucun corps demandé.":"No request body.";
  const rows=Object.entries(schema.properties??{}).map(([name,value])=>"| "+quoted(name)+" | "+quoted(type(value))+" | "+((schema.required??[]).includes(name)?(fr?"Oui":"Yes"):(fr?"Non":"No"))+" | "+quoted(translated(value.description,fr))+" "+quoted(Object.entries(value).filter(([key])=>["enum","minimum","maximum","minLength","maxLength","maxItems","pattern","default"].includes(key)).map(([key,value])=>key+"="+JSON.stringify(value)).join("; "))+" |");
  return rows.length?"| "+(fr?"Champ":"Field")+" | Type | "+(fr?"Obligatoire":"Required")+" | "+(fr?"Description et limites":"Description and limits")+" |\n| --- | --- | --- | --- |\n"+rows.join("\n"):fence+"text\n"+type(schema)+"\n"+fence;
 };
 const symbols={en:[],fr:[]},metadata=new Map(),operationGroups=new Map();
 for(const [route,methods]of Object.entries(spec.paths))for(const [method,op]of Object.entries(methods)){
  if(!["get","post","put","patch","delete","head","options"].includes(method))continue;
  const name=method.toUpperCase()+" "+route,key=slug(name),pageId="rest-"+slug(name)+"-"+key,group=classify(route);
  if(!titles[name])throw Error("Missing English/French API title: "+name);
  if(op.description&&!behavior[name])throw Error("Missing English/French API behavior: "+name);
  const refs=[...new Set([...JSON.stringify(op).matchAll(/#\/components\/schemas\/([^"]+)/g)].map(match=>match[1]))];
  metadata.set(pageId,{title:name,description:titles[name],parent:"api-http-"+group});
  if(!operationGroups.has(group))operationGroups.set(group,[]);
  operationGroups.get(group).push({pageId,name,titles:titles[name]});
  for(const locale of ["en","fr"]){
   const fr=locale==="fr",request=op.requestBody?deref(op.requestBody):undefined,content=request?.content??{};
   let description=titles[name][locale]+".\n\n"+(behavior[name]?.[locale]??"");
   if(request)description+="\n\n## "+(fr?"Corps de la requête":"Request body")+" {#body}\n\n"+Object.entries(content).map(([mime,value])=>mime+"\n\n"+table(value.schema,fr)).join("\n\n");
   const params=(op.parameters??[]).map(deref).filter(Boolean).map(p=>({name:p.name,type:type(p.schema),description:(fr?"Emplacement : ":"Location: ")+p.in+". "+(p.required?(fr?"Obligatoire. ":"Required. "):(fr?"Facultatif. ":"Optional. "))+translated(p.description,fr)}));
   symbols[locale].push({key,name,language:"http",kind:"operation",signature:name,description,parameters:params,returnType:"HTTP",returns:(fr?"Codes de réponse définis pour cette opération : ":"Response codes defined for this operation: ")+Object.keys(op.responses??{}).join(", ")+". "+(fr?"Les refus d’accès et les conflits ne doivent pas être réessayés sans traiter leur cause.":"Handle access failures and conflicts before retrying."),references:refs.map(ref=>({key:"schema-"+slug(ref),name:ref}))});
  }
 }
 for(const [name,schema]of Object.entries(spec.components?.schemas??{})){
  const key="schema-"+slug(name),pageId="rest-"+slug(name)+"-"+key;
  metadata.set(pageId,{title:name,description:{en:"Public JSON contract for "+name+".",fr:"Contrat JSON public de "+name+"."},parent:"api-models"});
  const refs=[...new Set([...JSON.stringify(schema).matchAll(/#\/components\/schemas\/([^"]+)/g)].map(match=>match[1]))].filter(ref=>ref!==name);
  for(const locale of ["en","fr"]){const fr=locale==="fr";symbols[locale].push({key,name,language:"text",kind:"schema",signature:name,description:(fr?"Cette structure décrit les valeurs échangées avec l’API, pas une implémentation.":"This structure describes values exchanged with the API, not an implementation.")+"\n\n## "+(fr?"Champs":"Fields")+" {#fields}\n\n"+table(schema,fr),references:refs.map(ref=>({key:"schema-"+slug(ref),name:ref}))});}
 }
 await fs.mkdir(path.join(work,"generated"),{recursive:true});
 const imported={};
 for(const locale of ["en","fr"]){
  const filename=path.join(work,"generated","api-"+locale+".json");await fs.writeFile(filename,JSON.stringify({symbols:symbols[locale]}));
  imported[locale]=await importApi([{format:"cydoc",prefix:"rest",path:filename,locale}],{base:work,locales:[{code:"en"},{code:"fr"}]});
 }
 for(const page of imported.en){
  const fr=imported.fr.find(value=>value.id===page.id);if(!fr)throw Error("French API page missing: "+page.id);
  const meta=metadata.get(page.id);await writePair(work,page.id,[meta.title,meta.title],[meta.description.en,meta.description.fr],meta.parent,250,[page.markdown,fr.markdown]);
 }
 for(const [key,group]of Object.entries(groups)){
  const entries=operationGroups.get(key)??[];
  if(!entries.length)continue;
  await writePair(work,"api-http-"+key,group,[group[0]+" endpoints and their request/response contracts.","Opérations et contrats de requête/réponse : "+group[1].toLowerCase()+"."],"api-http",180,["en","fr"].map(locale=>entries.map(entry=>"- ["+entry.titles[locale]+"](doc:"+entry.pageId+") · "+entry.name).join("\n")));
 }
 const schemas=Object.keys(spec.components.schemas);
 await writePair(work,"api-models",["Data contracts","Contrats de données"],["JSON structures exchanged with the public API.","Structures JSON échangées avec l’API publique."],"api-reference",190,["en","fr"].map(locale=>(locale==="fr"?"Ouvrez une structure pour consulter champs, types et références.":"Open a structure for its fields, types and references.")+"\n\n"+schemas.map(name=>"- ["+name+"](doc:rest-"+slug(name)+"-schema-"+slug(name)+")").join("\n")));
 await writePair(work,"api-http",["HTTP operations","Opérations HTTP"],["Choose an API area, then read its request and response contract.","Choisissez un domaine de l’API, puis consultez son contrat de requête et de réponse."],"api-reference",170,["en","fr"].map((locale,index)=>(locale==="fr"?"Les noms de routes et champs gardent leur orthographe technique. Les corps et autorisations sont ceux du contrat de l’opération.":"Route and field names retain their technical spelling. Each operation describes its request body and authorization behavior.")+"\n\n"+[...operationGroups.keys()].map(key=>"- ["+groups[key][index]+"](doc:api-http-"+key+")").join("\n")));
 const sdk=await fs.readFile(path.join(root,"packages/sdk-js/src/index.mjs"),"utf8"),comments=extractComments(sdk,"packages/sdk-js/src/index.mjs").filter(page=>page.id==="sdk-client");
 const sdkPart=sdk.slice(sdk.indexOf("export class CyTaskClient"));
 const signatures=[...sdkPart.matchAll(/^  (?:async )?([a-zA-Z]\w*)\(([^)]*)\)\s*\{/gm)].map(match=>match[1]+"("+match[2].replace(/\s+/g," ")+")");
 await writePair(work,"sdk-client",["JavaScript SDK","SDK JavaScript"],["Connect another application and use the client’s public methods.","Connectez une autre application et utilisez les méthodes publiques du client."],"api-reference",160,["en","fr"].map(locale=>{
  const fr=locale==="fr",authored=comments.find(page=>page.locale===locale)?.markdown;if(!authored)throw Error("Missing SDK annotation: "+locale);
  return authored+"\n\n## "+(fr?"API publique":"Public API")+" {#public-api}\n\n"+(fr?"Importez CyTaskClient et CyTaskApiError depuis le module distribué avec le SDK. Les identifiants transmis aux méthodes doivent être des UUID valides. Les appels réseau renvoient une promesse de réponse JSON ; les échecs exposent status et details. options.signal permet l’annulation.":"Import CyTaskClient and CyTaskApiError from the distributed SDK module. IDs passed to methods must be valid UUIDs. Network calls return a promise for the JSON response; failures expose status and details. Use options.signal for cancellation.")+"\n\n"+fence+"javascript\n"+signatures.join("\n")+"\n"+fence+"\n\n## "+(fr?"Exemple":"Example")+" {#example}\n\n"+fence+"javascript\nimport { CyTaskClient } from './packages/sdk-js/src/index.mjs';\nconst client = new CyTaskClient({\n  baseUrl: process.env.CYTASK_URL,\n  token: process.env.CYTASK_TOKEN\n});\nconst projects = await client.listProjects();\nconst tasks = await client.listTasks(projects[0].id);\n"+fence+"\n\n"+(fr?"createTask peut créer une tâche puis la rattacher à un parent. updateTask relit la révision avant l’écriture ; un conflit impose de recharger les données. claimTask prend une tâche de façon atomique. Consultez les [contrats HTTP](doc:api-http) pour les champs des requêtes.":"createTask can create a task then attach it to a parent. updateTask reads the current revision before writing; reload after a conflict. claimTask claims work atomically. See the [HTTP contracts](doc:api-http) for request fields.");
 }));
 return {operations:Object.values(spec.paths).reduce((count,methods)=>count+Object.keys(methods).filter(method=>["get","post","put","patch","delete","head","options"].includes(method)).length,0),schemas:schemas.length,signatures:signatures.length};
}
