import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";

export const slug=value=>String(value).normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const fence="~~~";
export const front=(id,title,section,order,body,tracking="")=>"---\nid: "+id+"\ntitle: "+title.replace(/\n/g," ")+"\nsection: "+section+"\norder: "+order+"\n"+tracking+"---\n\n"+body.trim()+"\n";
const digest=value=>createHash("sha256").update(value).digest("hex");
export async function prepare(root,stage,settings){
 const report={schemaVersion:1,guides:[],references:[],sourceFiles:[],unresolvedLinks:[],monolingualReferences:[],translationGaps:[],historical:[],excluded:settings.excluded};
 const referenceAnchors=JSON.parse(await fs.readFile(path.join(root,"packages/documentation/reference-anchors.json"),"utf8"));
 const sourceAnchorMaps=new Map(settings.references.map(entry=>[entry.source,referenceAnchors[entry.id]?.[entry.locale]??{}]));
 const canonicalAnchor=(source,anchor)=>sourceAnchorMaps.get(source)?.[slug(decodeURIComponent(anchor))]??anchor;
 for(const directory of ["content/en","content/fr","assets","api",...["sdk","unreal","contracts","help"].map(x=>"source/"+x)])await fs.mkdir(path.join(stage,directory),{recursive:true});
 for(const locale of ["en","fr"]){
  const source=path.join(root,"docs/user-guide",locale);
  for(const filename of (await fs.readdir(source)).filter(name=>name.endsWith(".md"))){
   const value=await fs.readFile(path.join(source,filename),"utf8");
   if(!value.startsWith("---\n")&&!value.startsWith("---\r\n"))throw Error("Unmigrated guide: "+filename);
   await fs.writeFile(path.join(stage,"content",locale,filename),value);
   report.guides.push({source:"docs/user-guide/"+locale+"/"+filename,sha256:digest(value)});
  }
 }
 const pageMap=new Map(settings.references.map(entry=>[entry.source,entry.id]));
 pageMap.set("docs/user-guide/README.md","documentation-status");
 pageMap.set("packages/documentation/README.md","documentation-status");
 pageMap.set("packages/contracts","api-reference");
 for(const filename of await fs.readdir(path.join(root,"docs/user-guide/en")))if(filename.endsWith(".md"))for(const locale of ["en","fr"])pageMap.set("docs/user-guide/"+locale+"/"+filename,filename.slice(0,-3));
 const assets=new Set(),extra=new Map();
 async function copyAsset(source){
  const normalized=path.posix.normalize(source);
  if(normalized.startsWith("../")||path.isAbsolute(normalized))throw Error("Asset outside repository");
  if(normalized.startsWith("assets/screenshots/")||normalized.startsWith("assets/branding/"))return normalized;
  if(normalized.startsWith("docs/images/"))return "assets/historical/"+path.posix.basename(normalized);
  const destination="assets/repository/"+normalized;
  if(!assets.has(normalized)){await fs.mkdir(path.dirname(path.join(stage,destination)),{recursive:true});await fs.copyFile(path.join(root,normalized),path.join(stage,destination));assets.add(normalized);}
  return destination;
 }
 for(const directory of ["assets/screenshots","assets/branding","docs/images"]){
  await fs.mkdir(path.join(stage,"assets",directory==="assets/screenshots"?"screenshots":directory==="assets/branding"?"branding":"historical"),{recursive:true});
  for(const name of await fs.readdir(path.join(root,directory))){const file=path.join(root,directory,name);if((await fs.stat(file)).isFile())await fs.copyFile(file,path.join(stage,"assets",directory==="assets/screenshots"?"screenshots":directory==="assets/branding"?"branding":"historical",name));}
 }
 async function target(href,source,locale,image=false){
  if(href.startsWith("#"))return "#"+canonicalAnchor(source,href.slice(1));
  if(href.startsWith("doc:"))return href;
  if(/^https?:\/\/github\.com\/MrMybal\/CyTask\/(?:blob|tree)\/(?:main|master)\//i.test(href))href="/"+href.replace(/^https?:\/\/github\.com\/MrMybal\/CyTask\/(?:blob|tree)\/(?:main|master)\//i,"");
  if(/^(?:https?:|mailto:)/.test(href)){if(image)throw Error("Remote documentary image: "+source);return href;}
  const [raw,anchor]=href.split("#");let repoPath=path.posix.normalize(href.startsWith("/")?raw.slice(1):path.posix.join(path.posix.dirname(source),decodeURIComponent(raw.replace(/^<|>$/g,""))));
  if(repoPath.startsWith("../"))throw Error("Link escapes repository: "+source);
  if(pageMap.has(repoPath))return "doc:"+pageMap.get(repoPath)+(anchor?"#"+canonicalAnchor(repoPath,anchor):"");
  if(/(?:^|\/)LICENSE(?:\.txt|\.md)?$/i.test(repoPath))return "doc:licenses";
  const info=await fs.stat(path.join(root,repoPath)).catch(()=>null);
  if(image&&info?.isFile())return copyAsset(repoPath);
  if(info?.isDirectory()&&pageMap.has(repoPath+"/README.md"))return "doc:"+pageMap.get(repoPath+"/README.md");
  if(info?.isFile()&&!/\.md$/i.test(repoPath)){
   const id="file-"+slug(repoPath);
   if(!extra.has(id)){
    const lang=repoPath.endsWith(".json")?"json":repoPath.endsWith(".cs")?"csharp":/\.(?:cpp|h)$/.test(repoPath)?"cpp":/\.[cm]?js$/.test(repoPath)?"javascript":"text";
    const text=await fs.readFile(path.join(root,repoPath),"utf8");
    if(text.includes("\0")){report.unresolvedLinks.push({source,target:href,reason:"Binary reference retained as source-path text"});return "";}
    extra.set(id,{id,path:repoPath,lang,text});
   }
   return "doc:"+id;
  }
  report.unresolvedLinks.push({source,target:href,reason:info?"Unmapped source document":"Not in repository"});
  return "";
 }
 async function rewrite(body,source,locale){
  body=body.replace(/<img\s+[^>]*src="([^"]+)"[^>]*>/g,(_,src)=>"![]( "+src+" )").replace(/<\/?(?:p|details|summary)\b[^>]*>/g,"");
  let out=[],inside=false,index=0;
  const lines=body.split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
   let line=lines[i];
   if(!inside&&/^(?:~~~|```)mermaid\s*$/.test(line)){
    const delimiter=line.slice(0,3),original=[];
    while(++i<lines.length&&!lines[i].startsWith(delimiter))original.push(lines[i]);
    const nodes=new Map(),edges=[];
    for(const row of original){
     const match=/^\s*([A-Za-z0-9_]+)(?:\[([^\]]+)\])?\s*-->\s*([A-Za-z0-9_]+)(?:\[([^\]]+)\])?/.exec(row);
     if(match){
      for(const[id,label]of [[match[1],match[2]],[match[3],match[4]]])if(label||!nodes.has(id))nodes.set(id,(label??id).replace(/^["'(]+|["')]+$/g,""));
      edges.push({from:match[1],to:match[3]});
     }
    }
    if(nodes.size&&nodes.size<=50){
     out.push("\n"+fence+"diagram\n"+JSON.stringify({type:"architecture",title:locale==="fr"?"Schéma d’architecture cible (conception)":"Target architecture diagram (design)",nodes:[...nodes].map(([id,label],n)=>({id,label,x:20+n%2*330,y:20+Math.floor(n/2)*120,width:300})),edges})+"\n"+fence);
    }
    out.push(fence+"details\n"+JSON.stringify({title:locale==="fr"?"Source Mermaid d’origine":"Original Mermaid source",body:fence+"mermaid\n"+original.join("\n")+"\n"+fence})+"\n"+fence);
    continue;
   }
   if(/^\s*(?:~~~|```)/.test(line)){inside=!inside;out.push(line);continue;}
   if(inside){out.push(line);continue;}
   const heading=/^(#{2,6})\s+(.+?)(?:\s+\{#([^}]+)\})?$/.exec(line);
   if(heading){
    const anchors=sourceAnchorMaps.get(source),key=slug(heading[2]);
    if(anchors&&Object.keys(anchors).length&&!anchors[key])throw Error("Unmapped translated reference heading: "+source+" / "+heading[2]);
    line=heading[1]+" "+heading[2]+" {#"+(anchors?.[key]??heading[3]??key)+"}";
   }
   // Turn the existing screenshot table into a gallery; retain its image captions.
   if(line.includes("|")&&i+2<lines.length&&/\|.*---/.test(lines[i+1])&&lines[i+2].includes("![")){i+=2;line=lines[i];}
   const inCode=index=>line.slice(0,index).split(String.fromCharCode(96)).length%2===0;
   const imageMatches=[...line.matchAll(/!\[([^\]]*)\]\(\s*([^)]+?)\s*\)/g)].filter(match=>!inCode(match.index));
   if(imageMatches.length){
    const items=[];
    for(const match of imageMatches){const src=await target(match[2],source,locale,true);if(src)items.push({type:"image",src,alt:match[1],controls:"minimal"});}
    if(!items.length){out.push(line);continue;}
    const kind=items.length>1?"gallery":"image",config=items.length>1?{id:"screenshots-"+(++index),controls:"minimal",items}:{id:"illustration-"+(++index),...items[0]};
    out.push("\n"+fence+kind+"\n"+JSON.stringify(config)+"\n"+fence+"\n");continue;
   }
   const matches=[...line.matchAll(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g)].filter(match=>!inCode(match.index));
   for(const match of matches){const url=await target(match[2],source,locale);line=line.replace(match[0],url?"["+match[1]+"]("+url+")":match[1]+" ("+match[2]+")");}
   out.push(line);
  }
  return out.join("\n");
 }
 const unique=[...new Set(settings.references.map(entry=>entry.id))];
 for(const [order,id]of unique.entries()){
  const variants=settings.references.filter(entry=>entry.id===id);
  if(variants.length>1){
   const maps=variants.map(entry=>({locale:entry.locale,ids:new Set(Object.values(sourceAnchorMaps.get(entry.source)))}));
   for(const variant of maps)for(const other of maps)if(variant!==other){
    const missing=[...variant.ids].filter(anchor=>!other.ids.has(anchor));
    if(missing.length)report.translationGaps.push({id,locale:other.locale,missingSections:missing});
   }
  }
  if(variants.length===1)report.monolingualReferences.push({id,language:variants[0].locale,source:variants[0].source});
  for(const locale of ["en","fr"]){
   const original=variants.find(entry=>entry.locale===locale)??variants[0],raw=await fs.readFile(path.join(root,original.source),"utf8");
   let title=/^# (.+)$/m.exec(raw)?.[1]??id,body=raw.replace(/^# .+\r?\n/m,"");
   const fromOther=original.locale!==locale;
   const notice=fromOther?(locale==="en"?"This reference is preserved in its original French. A complete English translation is not available.":"Cette référence est conservée dans sa langue d’origine anglaise. Sa traduction française complète n’est pas disponible."):"";
   const historical=["design","historical"].includes(original.status)?(locale==="fr"?"Document de conception ou historique : les objectifs ci-dessous ne garantissent pas des fonctions disponibles. Consultez les guides actuels pour le comportement livré.":"Design or historical reference: the goals below are not promises of shipped functionality. Consult the current guides for available behavior."):"";
   if(historical)report.historical.push({id,source:original.source,locale});
   body=await rewrite(body,original.source,locale);
   const gap=report.translationGaps.find(entry=>entry.id===id&&entry.locale===locale);
   const translationNotice=gap?(locale==="fr"?"La version anglaise contient aussi ces sections, absentes de la référence française d’origine : ":"The other source translation also contains these sections, absent here: ")+gap.missingSections.join(", "):"";
   if(gap){
    // Preserve a reachable section when switching locale, without presenting
    // untranslated source prose as a completed translation.
    for(const anchor of gap.missingSections){
     const fallback=variants.find(entry=>Object.values(sourceAnchorMaps.get(entry.source)).includes(anchor));
     const text=await fs.readFile(path.join(root,fallback.source),"utf8");
     const sections=[...text.matchAll(/^## (.+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
     const section=sections.find(match=>canonicalAnchor(fallback.source,slug(match[1]))===anchor);
     if(!section)throw Error("Missing reference fallback section: "+id+" / "+anchor);
     body+="\n\n"+await rewrite(section[0],fallback.source,locale);
    }
   }
   const banner=[notice,historical,translationNotice].filter(Boolean).map(text=>fence+"callout\n"+JSON.stringify({type:"note",title:locale==="fr"?"À propos de cette référence":"About this reference",body:text})+"\n"+fence).join("\n\n");
   const section=historical?(locale==="fr"?"Conception et historique":"Design and history"):(locale==="fr"?"Références techniques":"Technical references");
   await fs.writeFile(path.join(stage,"content",locale,id+".md"),front(id,title,section,100+order,banner+"\n\n"+body));
   report.references.push({id,locale,source:original.source,sourceLocale:original.locale,translated:!fromOther,sha256:digest(raw),status:original.status});
  }
 }
 for(const item of extra.values())for(const locale of ["en","fr"])await fs.writeFile(path.join(stage,"content",locale,item.id+".md"),front(item.id,path.posix.basename(item.path),locale==="fr"?"Contrats et exemples":"Contracts and examples",220,"Source: "+item.path+"\n\n"+fence+item.lang+"\n"+item.text+"\n"+fence));
 for(const item of settings.sourceAllowlist){
  const value=await fs.readFile(path.join(root,item.source),"utf8");
  if(value.includes("\0"))throw Error("Non-text source in allowlist");
  await fs.writeFile(path.join(stage,item.destination),value);
  report.sourceFiles.push({...item,sha256:digest(value)});
 }
 const specPath="apps/server/src/CyTask.Api/Contracts/openapi.json",spec=JSON.parse(await fs.readFile(path.join(root,specPath),"utf8"));
 const symbols=[];
 for(const [route,methods]of Object.entries(spec.paths))for(const [method,op]of Object.entries(methods).filter(([method])=>["get","post","put","patch","delete","head","options"].includes(method))){
  const name=method.toUpperCase()+" "+route,key=slug(name),parameters=(op.parameters??[]).map(param=>param.$ref?{name:param.$ref,type:"reference"}:{name:param.name,type:JSON.stringify(param.schema??{}),description:param.description??""});
  symbols.push({key,name,language:"http",kind:"operation",signature:name,parameters,returnType:"HTTP",returns:Object.keys(op.responses??{}).join(", "),description:[op.summary??"",op.description??"","Original OpenAPI operation (descriptions remain in their source language):",fence+"json",JSON.stringify(op,null,2),fence].join("\n\n")});
 }
 for(const[name,schema]of Object.entries(spec.components?.schemas??{}))symbols.push({key:"schema-"+slug(name),name,language:"json",kind:"schema",signature:JSON.stringify(schema,null,2),description:"OpenAPI component schema. References use the bundled contract, not a network service."});
 await fs.writeFile(path.join(stage,"api/openapi-symbols.json"),JSON.stringify({symbols}));
 report.api={source:specPath,operations:symbols.filter(x=>x.kind==="operation").length,schemas:symbols.filter(x=>x.kind==="schema").length,method:"OpenAPI → CyDoc neutral import (not a built-in OpenAPI parser)",sourceSha256:digest(JSON.stringify(spec))};
 report.api.auditScope=["Spaces/ProjectSpaceEndpoints.cs","Plugins/ContentPluginEndpoints.cs"];
 report.api.missingOperations=[];
 for(const relative of report.api.auditScope){
  const sourcePath="apps/server/src/CyTask.Api/"+relative,text=await fs.readFile(path.join(root,sourcePath),"utf8");
  const constant=/const string route = "([^"]+)"/.exec(text)?.[1];
  for(const match of text.matchAll(/\.Map(Get|Post|Put|Patch|Delete)\((?:"([^"]+)"|(route)),/g)){
   const route="/api/v1"+(match[2]??constant).replace(/\{(\w+):[^}]+\}/g,"{$1}");
   const method=match[1].toLowerCase();
   if(!spec.paths[route]?.[method])report.api.missingOperations.push({method:method.toUpperCase(),route,source:sourcePath});
  }
 }
 await fs.writeFile(path.join(stage,"assets/openapi.json"),JSON.stringify(spec,null,2));
 await fs.writeFile(path.join(stage,"migration-report.json"),JSON.stringify(report,null,2));
 return report;
}
