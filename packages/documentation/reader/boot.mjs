import {mountViewer} from "cydoc/viewer";
import {createLink,parseLink} from "cydoc";
const data=globalThis.CYDOC_DATA,options=globalThis.CYDOC_OPTIONS??{};
const root=document.getElementById("app"),legacy=globalThis.CYTASK_LEGACY_ANCHORS??{};
const allowed=new Set(["image","gallery"]),modulePromises=new Map(),assetPromises=new Map();
function stored(key){try{return localStorage.getItem(key);}catch{return null;}}
function normalizeRoute(){
 const language=new URLSearchParams(location.search).get("lang");
 const fallback=language==="fr"?"fr":language==="en"?"en":stored("cytask.locale")==="fr"?"fr":"en";
 const old=/^#\/guide\/([a-z0-9-]+)(?:\?(.*))?$/.exec(location.hash);
 if(old){
  const state=new URLSearchParams(old[2]),section=state.get("section");
  const route={locale:fallback,pageId:old[1],...(section?{anchor:legacy[fallback]?.[old[1]]?.[section]??section}:{})};
  history.replaceState(null,"",location.pathname+location.search+createLink(route));
 }else if(!location.hash||location.hash==="#")history.replaceState(null,"",location.pathname+location.search+createLink({locale:fallback,pageId:options.homePage??"getting-started"}));
}
normalizeRoute();window.addEventListener("hashchange",normalizeRoute);
function localScript(filename,read){
 return new Promise((resolve,reject)=>{
  const script=document.createElement("script");script.src=filename;
  script.onload=()=>{script.remove();try{resolve(read());}catch(error){reject(error);}};
  script.onerror=()=>{script.remove();reject(Error("Cannot load bundled documentation resource: "+filename));};
  document.head.append(script);
 });
}
const modules=Object.fromEntries((options.modules??[]).map(name=>{
 if(!allowed.has(name))throw Error("Unselected CyDoc reader: "+name);
 return [name,()=>{
  if(!modulePromises.has(name))modulePromises.set(name,localScript("media-"+name+".js",()=>globalThis["CyDocMedia_"+name].default).catch(error=>{modulePromises.delete(name);throw error;}));
  return modulePromises.get(name);
 }];
}));
function loadAsset(src){
 if(!assetPromises.has(src)){
  const file=options.assets?.[src];
  if(!file||!/^[a-zA-Z0-9_./-]+\.js$/.test(file)||/(?:^|\/)\.\.(?:\/|$)/.test(file)||file.startsWith("/"))return Promise.reject(Error("Unpackaged local asset"));
  assetPromises.set(src,localScript(file,()=>{const asset=globalThis.CYDOC_ASSETS?.[src];if(!asset)throw Error("Invalid packed asset");return asset;}).catch(error=>{assetPromises.delete(src);throw error;}));
 }
 return assetPromises.get(src);
}
const preferred=stored("cydoc:theme")??stored("cytask.help.tone");
const viewer=mountViewer(root,data,{homePage:options.homePage,initialLocale:"en",initialTheme:preferred??"dark",storageId:"cytask-help",modules,loadAsset});
let updating=false;
function adaptShell(){
 if(updating)return;updating=true;
 queueMicrotask(()=>{
  updating=false;
  const locale=parseLink(location.hash,"en","getting-started").locale,fr=locale==="fr";
  const footer=root.querySelector(".footer>div>span:last-child");
  if(footer&&!footer.classList.contains("cytask-license")){footer.classList.add("cytask-license");footer.textContent="CyTask GPL-3.0-or-later · CyDoc MIT";}
  const tag=root.querySelector(".mit-tag");if(tag)tag.title="CyDoc reader · MIT";
  const actions=root.querySelector(".topbar-actions");
  if(actions&&/^https?:$/.test(location.protocol)&&!actions.querySelector(".cytask-offline-download")){
   const link=document.createElement("a");link.className="top-link cytask-offline-download";link.href="./cytask-help.zip";link.download="CyTask-help.zip";
   link.textContent=fr?"Guide hors ligne":"Offline guide";link.title=fr?"Télécharger, extraire puis ouvrir index.html en local":"Download, extract and open index.html locally";actions.prepend(link);
  }
 });
}
const observer=new MutationObserver(adaptShell);observer.observe(root,{childList:true,subtree:true});adaptShell();
root.addEventListener("click",event=>{if(event.target.closest?.(".skip-link")){event.preventDefault();document.getElementById("main-content")?.focus();}},true);
window.addEventListener("pagehide",()=>{observer.disconnect();viewer.destroy();},{once:true});
if(/^https?:$/.test(location.protocol)&&"serviceWorker" in navigator){
 const scope=new URL("./",location.href).href;
 void navigator.serviceWorker.getRegistrations().then(async registrations=>{
  for(const registration of registrations)if(registration.scope===scope)await registration.unregister();
  if("caches" in globalThis)for(const name of await caches.keys())if(name.startsWith("cytask-help-"))await caches.delete(name);
 }).catch(()=>{});
}
