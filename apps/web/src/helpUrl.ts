import {createLink} from "cydoc";
import type {Locale} from "./i18n";

/**
 * @doc help-routing
 * @locale en
 * @title Contextual documentation links
 * @section API
 * @symbol helpUrl
 * CyDoc page IDs and explicit anchors are shared by both translations.
 * ## Targets {#targets}
 * Supply a locale, pageId, optional anchor and media state.
 * Desktop converts this public route into a correctly encoded local file URL.
 */
/**
 * @doc help-routing
 * @locale fr
 * @title Liens de documentation contextuelle
 * @section API
 * @symbol helpUrl
 * Les deux traductions partagent les identifiants de pages et les ancres explicites.
 * ## Cibles {#targets}
 * Fournissez langue, pageId, ancre facultative et état du média.
 * Le desktop transforme cette route publique en URL de fichier local encodée.
 */
export function helpUrl(locale:Locale,pageId="getting-started",anchor?:string,state?:Record<string,string>){
  return createLink({locale,pageId,anchor,state},"/help/manual.html");
}
