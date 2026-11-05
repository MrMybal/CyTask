import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import {existsSync} from "node:fs";
import {fileURLToPath,pathToFileURL} from "node:url";
import path from "node:path";
import {prepare,front,slug} from "../packages/documentation/prepare.mjs";
import {zip} from "../packages/documentation/archive.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const project=path.join(root,"packages/documentation"),stage=path.join(root,".build/cydoc-project");
const destination=path.join(root,"apps/web/public/help");
const require=createRequire(path.join(project,"package.json"));
const packageLock=await fs.readFile(path.join(project,"package-lock.json"));
const lockHash=createHash("sha256").update(packageLock).digest("hex"),stamp=path.join(root,".build/documentation-lock.sha256");
if(!existsSync(path.join(project,"node_modules/cydoc/dist/viewer.js"))||(await fs.readFile(stamp,"utf8").catch(()=>""))!==lockHash){
 const npm=process.platform==="win32"?"npm.cmd":"npm";
 const installed=spawnSync(npm,["ci","--no-audit","--no-fund"],{cwd:project,shell:process.platform==="win32",stdio:"inherit"});
 if(installed.status!==0)process.exit(installed.status??1);
 await fs.mkdir(path.dirname(stamp),{recursive:true});await fs.writeFile(stamp,lockHash);
}
async function resetGenerated(directory,expected){
 if(path.resolve(directory)!==path.resolve(expected)||!directory.startsWith(root+path.sep)||directory===root)throw Error("Refusing to replace an unvalidated output");
 const stat=await fs.lstat(directory).catch(()=>null);if(stat?.isSymbolicLink())throw Error("Output must not be a symbolic link");
 await fs.rm(directory,{recursive:true,force:true});await fs.mkdir(directory,{recursive:true});
}
await resetGenerated(stage,path.join(root,".build/cydoc-project"));
const config=JSON.parse(await fs.readFile(path.join(project,"cydoc.config.json"),"utf8"));
const settings=JSON.parse(await fs.readFile(path.join(project,"imports.json"),"utf8"));
const report=await prepare(root,stage,settings);
if(report.unresolvedLinks.length)throw Error("Resolve the source links listed in .build/cydoc-project/migration-report.json before exporting");
async function page(id,titles,section,order,bodies){
 if(id==="api-reference"){
  const gaps=report.api.missingOperations.map(item=>"- "+item.method+" "+item.route+" · "+item.source).join("\n");
  bodies.en+="\n\n## Verified contract gaps {#contract-gaps}\n\nThe room/content-extension audit found "+report.api.missingOperations.length+" implemented routes missing from OpenAPI. This is a scoped comparison, not a full semantic routing analysis.\n\n"+(gaps||"None in the audited scope.");
  bodies.fr+="\n\n## Lacunes du contrat vérifiées {#contract-gaps}\n\nLa comparaison des salons/extensions de contenu détecte "+report.api.missingOperations.length+" routes présentes dans le code et absentes d’OpenAPI. Ce contrôle ciblé n’est pas une analyse sémantique complète du routage.\n\n"+(gaps||"Aucune dans le périmètre contrôlé.");
 }
 const revision=createHash("sha256").update(bodies.en).digest("hex").slice(0,12);
 for(const locale of ["en","fr"])await fs.writeFile(path.join(stage,"content",locale,id+".md"),front(id,titles[locale],section[locale],order,bodies[locale],locale==="en"?"revision: "+revision+"\n":"sourceRevision: "+revision+"\n"));
}
const screenshots=[
 {src:"assets/screenshots/tasks-compact.png",en:"Compact task table",fr:"Tableau compact des tâches"},
 {src:"assets/screenshots/kanban.png",en:"Kanban board",fr:"Tableau Kanban"},
 {src:"assets/screenshots/team-chat.png",en:"Project chat",fr:"Tchat du projet"},
 {src:"assets/screenshots/tasks-light.png",en:"Light theme",fr:"Thème clair"}
];
await page("screenshots",{en:"Application screenshots",fr:"Captures de l’application"},{en:"Everyday work",fr:"Travail quotidien"},24,Object.fromEntries(["en","fr"].map(locale=>[locale,
 (locale==="fr"?"Les captures utilisent le projet fictif Nebula Station. Les textes du projet restent dans leur langue d’origine.":"Screenshots use the fictional Nebula Station project. User-authored project text remains in its original language.")+
 "\n\n## "+(locale==="fr"?"Parcourir les vues":"Explore the views")+" {#views}\n\n~~~gallery\n"+JSON.stringify({id:"application-gallery",title:locale==="fr"?"Vues de CyTask":"CyTask views",controls:"minimal",items:screenshots.map(item=>({type:"image",src:item.src,alt:item[locale],title:item[locale]}))})+"\n~~~"
])));
const symbols=JSON.parse(await fs.readFile(path.join(stage,"api/openapi-symbols.json"),"utf8")).symbols;
const apiRows=symbols.map(symbol=>"- ["+symbol.name+"](doc:rest-"+slug(symbol.name)+"-"+symbol.key+")").join("\n");
await page("api-reference",{en:"API and public source reference",fr:"API et sources publiques"},{en:"API",fr:"API"},90,{
 en:"## HTTP contract {#http}\n\nThis reference imports the checked-in OpenAPI 3.1 contract through CyDoc’s neutral API adapter: "+report.api.operations+" operations and "+report.api.schemas+" schemas. It does not query a live server. Original schema descriptions retain their source language.\n\nThe contract may lag newer room or content features. Use the protocol references and current implementation when a route is not covered; do not infer an undocumented endpoint.\n\n## SDK and source index {#source}\n\n[SDK client](doc:sdk-client) · [MCP](doc:mcp-integration) · [Plugin protocol](doc:plugin-api-reference)\n\nOnly the SDK, public C# request/response contracts, help-route adapter and public Unreal headers are indexed. The index is lexical: it does not resolve overloads or convert C# XML documentation. No Doxygen or TypeDoc toolchain is needed for this integration.\n\n## Operations and schemas {#operations}\n\n"+apiRows,
 fr:"## Contrat HTTP {#http}\n\nCette référence importe le contrat OpenAPI 3.1 versionné via l’adaptateur neutre CyDoc : "+report.api.operations+" opérations et "+report.api.schemas+" schémas. Aucun serveur actif n’est interrogé. Les descriptions gardent leur langue source.\n\nLe contrat peut être en retard sur certaines fonctions de salons ou de contenus. Consultez protocoles et implémentation actuelle lorsqu’une route manque ; n’inventez pas d’endpoint.\n\n## SDK et index des sources {#source}\n\n[Client SDK](doc:sdk-client) · [MCP](doc:mcp-integration) · [Protocole plugins](doc:plugin-api-reference)\n\nSeuls SDK, contrats C# publics, adaptateur de liens d’aide et en-têtes Unreal publics sont indexés. L’index est lexical : ni résolution de surcharges, ni conversion des commentaires XML C#. Doxygen et TypeDoc ne sont pas requis ici.\n\n## Opérations et schémas {#operations}\n\n"+apiRows
});
const mono=report.monolingualReferences.map(entry=>"- ["+entry.id+"](doc:"+entry.id+") · "+entry.language).join("\n");
await page("documentation-status",{en:"Documentation scope and maintenance",fr:"Périmètre et maintenance du guide"},{en:"Maintenance",fr:"Maintenance"},95,{
 en:"## Local reader {#local}\n\nDesktop opens the complete bundled manual with a file URL. On the Web, use Download offline guide, extract the archive and open index.html. Browsers do not permit a Web page to launch an arbitrary local file. All reading assets are packaged; no CDN, API or server is needed to read the extracted copy.\n\n## Translations {#translations}\n\nThe 24 user-guide chapters are authored in English and French with shared page and section IDs. English is the fallback locale. [Translation status](doc:translation-report) reports missing, outdated and untracked revisions. Generated API/source pages are mechanically bilingual; original descriptions are not machine-translated.\n\nThe references below existed in one language only. Their complete original content is retained, with an explicit language notice in the other locale. They are not advertised as complete translations:\n\n"+mono+"\n\n## Design and remaining gaps {#gaps}\n\nVision, architecture targets, roadmap and old interface notes retain their original meaning and are marked as design/history. S3 deployment, general transcoding, signed third-party plugins, full Unreal-version validation and large-call infrastructure must not be inferred from those plans. Android native integration, macOS and Linux file/storage behavior still require target-device testing. CyDoc loads all pages together; very large manuals may need a future segmentation strategy.\n\n## Regenerate {#regenerate}\n\n~~~sh\nnpm ci --prefix packages/documentation\nnode scripts/build-help.mjs\nnpm run test:help --prefix apps/web\n~~~",
 fr:"## Lecteur local {#local}\n\nLe desktop ouvre le manuel embarqué avec une URL file. Sur le Web, utilisez Télécharger le guide hors ligne, extrayez l’archive et ouvrez index.html. Un navigateur n’autorise pas un site à lancer un fichier local arbitraire. Toutes les ressources sont incluses ; ni CDN, ni API, ni serveur ne sont nécessaires après extraction.\n\n## Traductions {#translations}\n\nLes 24 chapitres utilisateur sont rédigés en anglais et français avec les mêmes identifiants de pages et sections. L’anglais sert de repli. [État des traductions](doc:translation-report) signale révisions absentes, dépassées et non suivies. API et sources sont structurées dans les deux langues ; leurs descriptions d’origine ne sont pas traduites automatiquement.\n\nCes références n’existaient que dans une langue. Leur contenu original complet est conservé, avec un avertissement dans l’autre langue. Il ne s’agit pas de traductions complètes :\n\n"+mono+"\n\n## Conception et limites restantes {#gaps}\n\nVision, architecture cible, feuille de route et anciennes notes d’interface sont marquées conception/historique. Elles ne prouvent pas la disponibilité de S3, du transcodage général, des plugins tiers signés, de toutes les versions Unreal ou des grands appels. Android natif, macOS et Linux doivent encore être testés sur leurs appareils. CyDoc charge toutes les pages ensemble ; une très grande documentation nécessitera une segmentation future.\n\n## Régénérer {#regenerate}\n\n~~~sh\nnpm ci --prefix packages/documentation\nnode scripts/build-help.mjs\nnpm run test:help --prefix apps/web\n~~~"
});
const ownLicense=await fs.readFile(path.join(root,"LICENSE"),"utf8"),cydocLicense=await fs.readFile(path.join(project,"node_modules/cydoc/LICENSE"),"utf8");
await page("licenses",{en:"Licenses",fr:"Licences"},{en:"Maintenance",fr:"Maintenance"},96,Object.fromEntries(["en","fr"].map(locale=>[locale,"CyTask: GPL-3.0-or-later. CyDoc: MIT.\n\n## CyTask {#cytask}\n\n~~~text\n"+ownLicense+"\n~~~\n\n## CyDoc {#cydoc}\n\n~~~text\n"+cydocLicense+"\n~~~"])));
await fs.writeFile(path.join(stage,"cydoc.config.json"),JSON.stringify(config,null,2));
const cli=path.join(project,"node_modules/cydoc/tools/cli.mjs");
const result=spawnSync(process.execPath,[cli,process.argv.includes("--check")?"check":"build",path.join(stage,"cydoc.config.json")],{cwd:project,stdio:"inherit"});
if(result.status!==0)process.exit(result.status??1);
const output=path.join(stage,config.out);
const {build}=await import(pathToFileURL(require.resolve("esbuild")).href);
await build({entryPoints:[path.join(project,"reader/boot.mjs")],bundle:true,format:"iife",minify:true,target:"es2020",outfile:path.join(output,"viewer.js"),legalComments:"eof"});
await fs.copyFile(path.join(project,"reader/index.html"),path.join(output,"index.html"));
await fs.copyFile(path.join(project,"reader/index.html"),path.join(output,"manual.html"));
await build({entryPoints:[path.join(project,"native/links.mjs")],bundle:true,format:"cjs",platform:"node",target:"node22",outfile:path.join(root,"apps/client/build/help-links.cjs"),legalComments:"eof"});
await fs.copyFile(path.join(project,"reader/cytask.css"),path.join(output,"cytask.css"));
await fs.copyFile(path.join(project,"reader/retire-worker.js"),path.join(output,"sw.js"));
const legacy=JSON.parse(await fs.readFile(path.join(project,"legacy-anchors.json"),"utf8"));
await fs.writeFile(path.join(output,"compatibility.js"),"globalThis.CYTASK_LEGACY_ANCHORS="+JSON.stringify(legacy)+";\n");
await fs.copyFile(path.join(output,"assets/branding/cytask-logo.png"),path.join(output,"assets/favicon.png"));
await fs.writeFile(path.join(output,"LICENSE-CyTask.txt"),ownLicense);await fs.writeFile(path.join(output,"LICENSE-CyDoc.txt"),cydocLicense);
let notices="CyTask: GPL-3.0-or-later. CyDoc reader: MIT.\nBuild-time syntax highlighting/compiler dependencies:\n";
for(const name of ["marked","prismjs","esbuild"]){
 const directory=path.join(project,"node_modules",name),file=(await fs.readdir(directory)).find(file=>/^licen[cs]e(?:\.md|\.txt)?$/i.test(file));
 if(!file)throw Error("Missing dependency license: "+name);
 notices+="\n--- "+name+" ---\n"+await fs.readFile(path.join(directory,file),"utf8");
}
await fs.writeFile(path.join(output,"THIRD-PARTY-NOTICES.txt"),notices);
await fs.writeFile(path.join(output,"migration-report.json"),JSON.stringify(report,null,2));
await fs.writeFile(path.join(output,"README.txt"),"CyTask documentation — CyDoc\n\nExtract this entire directory. Open index.html directly using file://.\nNo Web server, Node.js, API or Internet connection is required for reading.\nKeep all scripts, styles, notices and assets together.\n");
async function list(dir){return(await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>entry.isDirectory()?[]:[path.join(dir,entry.name)]).concat(...await Promise.all((await fs.readdir(dir,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>list(path.join(dir,entry.name)))));}
const files=await list(output),archive=[];
for(const file of files)archive.push([path.relative(output,file).split(path.sep).join("/"),await fs.readFile(file)]);
await fs.writeFile(path.join(output,"cytask-help.zip"),zip(archive));
await resetGenerated(destination,path.join(root,"apps/web/public/help"));
await fs.cp(output,destination,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(output,"manifest.json"),"utf8"));
console.log("CyTask CyDoc export: "+manifest.pages.length+" localized pages; image + gallery; offline ZIP ready.");
