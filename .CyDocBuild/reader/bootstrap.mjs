import {mountViewer} from "cydoc/viewer";
import {createLink} from "cydoc";
const options=globalThis.CYDOC_OPTIONS??{},data=globalThis.CYDOC_DATA,legacy=globalThis.CYTASK_LEGACY_ANCHORS??{};
function stored(key){try{return localStorage.getItem(key);}catch{return null;}}
function normalizeLegacy(){
 const query=new URLSearchParams(location.search),locale=query.get("lang")==="fr"?"fr":"en";
 const old=/^#\/guide\/([a-z0-9-]+)(?:\?(.*))?$/.exec(location.hash);
 if(old){const anchor=new URLSearchParams(old[2]).get("section");history.replaceState(null,"",location.pathname+location.search+createLink({locale,pageId:old[1],...(anchor?{anchor:legacy[locale]?.[old[1]]?.[anchor]??anchor}:{})}));}
 else if(!location.hash||location.hash==="#")history.replaceState(null,"",location.pathname+location.search+createLink({locale,pageId:options.homePage??"getting-started"}));
}
normalizeLegacy();window.addEventListener("hashchange",normalizeLegacy);
const modules=new Map(),assets=new Map(),allowed=new Set(["image","gallery"]);
function script(file,read){return new Promise((resolve,reject)=>{const element=document.createElement("script");element.src="DocData/"+file;element.onload=()=>{element.remove();try{resolve(read());}catch(error){reject(error);}};element.onerror=()=>{element.remove();reject(Error("Unable to read local resource: "+file));};document.head.append(element);});}
const loaders=Object.fromEntries((options.modules??[]).map(name=>{
 if(!allowed.has(name))throw Error("Unselected documentation module");
 return [name,()=>{if(!modules.has(name))modules.set(name,script("media-"+name+".js",()=>globalThis["CyDocMedia_"+name].default));return modules.get(name);}];
}));
function loadAsset(src){
 const file=options.assets?.[src];
 if(!file||!/^[a-zA-Z0-9_./-]+\.js$/.test(file)||file.includes("..")||file.startsWith("/"))return Promise.reject(Error("Unpackaged documentation asset"));
 if(!assets.has(src))assets.set(src,script(file,()=>{const value=globalThis.CYDOC_ASSETS?.[src];if(!value)throw Error("Invalid local asset");return value;}));
 return assets.get(src);
}
const root=document.getElementById("app");
const viewer=mountViewer(root,data,{homePage:options.homePage,initialLocale:"en",initialTheme:stored("cydoc:theme")??"dark",storageId:"cytask-help",assetBase:"DocData/",modules:loaders,loadAsset});
function downloadLink(){
 if(!/^https?:$/.test(location.protocol))return;
 const footer=root.querySelector(".footer");
 if(!footer||footer.querySelector(".cytask-offline-download"))return;
 const link=document.createElement("a");link.className="top-link cytask-offline-download";link.href="DocData/cytask-help.zip";link.download="CyTask-documentation.zip";
 link.textContent=document.documentElement.lang==="fr"?"Télécharger le guide hors ligne":"Download offline guide";footer.append(link);
}
const observer=new MutationObserver(downloadLink);observer.observe(root,{childList:true,subtree:true});downloadLink();
window.addEventListener("pagehide",()=>{observer.disconnect();viewer.destroy();},{once:true});
