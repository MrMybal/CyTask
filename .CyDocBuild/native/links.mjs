import path from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {createLink,parseLink} from "cydoc";
import legacy from "../legacy-anchors.json" with {type:"json"};

export function normalizeHelpTarget(value={}){
 const target=typeof value==="string"?{locale:value}:value??{};
 const locale=target.locale==="fr"?"fr":"en";
 const pageId=/^[a-z0-9][a-z0-9-]{0,512}$/.test(target.pageId??"")?target.pageId:"getting-started";
 const anchor=/^[a-zA-Z0-9_-]{1,160}$/.test(target.anchor??"")?target.anchor:undefined;
 const state=Object.fromEntries(Object.entries(target.state??{}).filter(([key,value])=>["media","zoom","x","y","item","note","wipe"].includes(key)&&typeof value==="string"&&value.length<=160));
 return {locale,pageId,...(anchor?{anchor}:{}),...(Object.keys(state).length?{state}:{})};
}
export function createLocalHelpUrl(file,target){
 if(!path.isAbsolute(file))throw Error("Documentation path must be absolute");
 return createLink(normalizeHelpTarget(target),pathToFileURL(file).href);
}
export function readHelpRoute(value){
 try{return normalizeHelpTarget(parseLink(new URL(value).hash,"en","getting-started"));}catch{return normalizeHelpTarget();}
}
export function webHelpTarget(value,trustedOrigin){
 try{
  const url=new URL(value);
  if(url.origin!==trustedOrigin||!["/Documentation/Documentation.html","/help/index.html","/help/manual.html"].includes(url.pathname))return null;
  const locale=url.searchParams.get("lang")==="fr"?"fr":"en";
  const old=/^#\/guide\/([a-z0-9-]+)(?:\?(.*))?$/.exec(url.hash);
  if(old){const section=new URLSearchParams(old[2]).get("section");return normalizeHelpTarget({locale,pageId:old[1],anchor:legacy[locale]?.[old[1]]?.[section]??section});}
  return normalizeHelpTarget(parseLink(url.hash,locale,"getting-started"));
 }catch{return null;}
}
export function isHelpFileUrl(value,root){
 try{
  const url=new URL(value);if(url.protocol!=="file:"||url.hostname&&url.hostname!=="localhost"||url.username||url.password)return false;
  const file=path.resolve(fileURLToPath(url)),base=path.resolve(root),relative=path.relative(base,file);
  return relative!==""&&!relative.startsWith(".."+path.sep)&&relative!==".."&&!path.isAbsolute(relative);
 }catch{return false;}
}
