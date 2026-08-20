# Modèle de sécurité initial

La sécurité de CyTask est une propriété testée et opérée, pas une promesse absolue.
Le projet doit publier son modèle de menace, ses avis de sécurité et une procédure
de signalement avant la première version publique.

## Actifs à protéger

- comptes, sessions, secrets d'intégration et clés de signature ;
- tâches, commentaires, médias et dépôts privés ;
- séparation entre organisations ;
- postes Unreal capables de modifier des assets ;
- disponibilité du serveur et capacité de restauration ;
- chaîne de publication des applications et plugins.

## Menaces prioritaires

- contournement de contrôle d'accès ou fuite inter-organisation ;
- vol de session, jeton trop long ou secret enregistré en clair ;
- plugin, recette Unreal ou média hostile ;
- SSRF et exécution de commandes via un connecteur Git ;
- archive piégée, bombe de décompression ou média épuisant les ressources ;
- webhook forgé/rejoué et job exécuté plusieurs fois ;
- dépendance ou mise à jour compromise ;
- ransomware, suppression accidentelle et sauvegarde inutilisable.

## Exigences de conception

### Identité et sessions

- OIDC pour les organisations, comptes locaux optionnels et passkeys ;
- mots de passe avec Argon2id et paramètres versionnés ;
- MFA, codes de récupération et révocation de toutes les sessions ;
- cookies Secure, HttpOnly et SameSite avec protection CSRF ;
- jetons d'API stockés hachés, affichés une seule fois et limités par portée ;
- invitations stockées hachées, expirables, à usage unique et transmises dans le fragment d'URL côté navigateur ;
- flux OAuth avec PKCE pour applications et Unreal, sans secret embarqué ;
- secrets système stockés via le gestionnaire de secrets de l'OS ou du déploiement.

### Autorisation et multi-tenant

- refus par défaut et contrôle d'organisation sur chaque accès ;
- politiques centralisées, testées sur toutes les routes et tous les jobs ;
- rôles simples au début, permissions explicites pour les actions sensibles ;
- aucune confiance dans un identifiant d'organisation envoyé par le client ;
- tests automatiques de non-régression contre les accès croisés.

La tranche actuelle journalise les mutations principales dans `audit_events`,
avec l'auteur dénormalisé pour conserver une lecture après désactivation d'un
compte. L'API ne fournit aucune route de modification ou suppression de ce journal.

### Réseau et déploiement

- TLS obligatoire hors boucle locale, HSTS et en-têtes Web stricts ;
- services de données non publiés sur Internet ;
- limitation de débit par identité et par origine avec plafonds globaux ;
- configuration de proxy de confiance explicite ;
- images de conteneurs minimales, non-root et idéalement en lecture seule ;
- journaux structurés sans jetons, mots de passe ni URL signées.

### Plugins et chaîne logicielle

- manifeste et artefact couverts par la signature ;
- permissions lisibles et nouvelle approbation lors de leur élargissement ;
- runtime isolé ou processus séparé, quotas CPU/mémoire/temps et arrêt forcé ;
- réseau sortant refusé par défaut et domaines autorisés explicitement ;
- SBOM, dépendances verrouillées, analyse de vulnérabilités et builds reproductibles
  autant que possible ;
- signature distincte pour canal stable, bêta et développement.

### Fichiers, médias et Git

- détection par contenu, noms normalisés et stockage hors racine Web ;
- quarantaine avant exposition, limites avant et pendant décodage ;
- workers médias sans accès aux secrets de l'application ;
- URLs signées courtes et liées à une opération précise ;
- Git sans interpolation shell, protocoles autorisés et contrôle des redirections ;
- clés SSH vérifiées, secrets par dépôt et effacement après usage ;
- aucune prévisualisation HTML/SVG active sans assainissement et isolation.

Les références Git manuelles actuelles n'effectuent aucune requête sortante. Les
liens sont limités à HTTPS, refusent les identifiants intégrés et sont ouverts côté
client avec `noopener noreferrer`. Ils ne constituent pas encore une preuve qu'un
commit existe ou appartient réellement au dépôt déclaré.

La tranche actuelle applique déjà les barrières suivantes : nom sans chemin,
taille annoncée bornée, SHA-256 complet et par bloc, ordre strict des blocs,
stockage confiné hors de `wwwroot` et quarantaine non téléchargeable. La détection
magique initiale ne constitue pas une validation antivirus : seul un futur worker
isolé pourra promouvoir une variante réencodée vers l'état `available`.

### Unreal et recettes d'assets

Le flux natif suit [PKCE RFC 7636](https://www.rfc-editor.org/rfc/rfc7636) et les
recommandations [OAuth 2.0 for Native Apps RFC 8252](https://www.rfc-editor.org/rfc/rfc8252).

- autorisation dans le navigateur externe avec PKCE `S256`, jamais dans une WebView contrôlée par le plugin ;
- callback uniquement sur `127.0.0.1` ou `::1`, port dynamique et chemin fixe ;
- code haché, valable cinq minutes, lié au client et au callback, consommable une fois ;
- Bearer opaque haché, court, révocable et sans repli vers un cookie si le header est invalide ;
- Bearer Unreal conservé uniquement en mémoire, écrasé à la fermeture et révoqué côté serveur lors d'une déconnexion explicite ;
- recette liée à une tâche, un auteur, une révision et une empreinte ;
- validation côté serveur et côté plugin ;
- aperçu des fichiers/assets affectés et confirmation locale ;
- liste fermée d'actions standard, chemins confinés au projet ;
- transaction éditeur, sauvegarde contrôlée et journal du résultat ;
- scripts arbitraires désactivés par défaut même pour un administrateur serveur.

## Exploitation sûre

- sauvegardes chiffrées, versionnées et protégées contre l'effacement immédiat ;
- test de restauration automatique et exercice humain régulier ;
- rotation des clés, horloge synchronisée et politique de rétention ;
- audit append-only exportable vers un système externe ;
- alertes sur échecs d'authentification, hausse des erreurs et files bloquées ;
- mode maintenance documenté et procédure de mise à jour avec retour arrière.

## Barrières avant publication

- revue du modèle de menace ;
- tests d'autorisation et fuzzing des contrats exposés ;
- analyse statique, dépendances et secrets dans la CI ;
- test d'intrusion indépendant sur identité, médias, plugins et Git ;
- restauration chronométrée d'une installation réaliste ;
- politique de divulgation et canal privé de signalement.
