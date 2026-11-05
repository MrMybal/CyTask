---
id: mfa
title: Double authentification
section: Sécurité et exploitation
order: 18
sourceRevision: 1
---

L’administrateur choisit une politique désactivée, facultative ou obligatoire. Gérez vos facteurs dans Paramètres et outils → Sécurité du compte.

## Configurer un authentificateur {#enroll-an-authenticator}
Choisissez sa configuration, confirmez votre mot de passe et scannez le QR code avec une application compatible comme Google Authenticator. Vous pouvez saisir manuellement la clé affichée. Validez avec le code courant à six chiffres.

Les codes changent toutes les 30 secondes. Synchronisez les horloges du serveur et de l’appareil. Le QR code est généré dans le navigateur ; aucun compte Google connecté n’est nécessaire.

## Courriel et récupération {#email-and-recovery}
Les codes par courriel nécessitent l’autorisation du serveur et une messagerie TLS configurée. Après un renvoi, utilisez le dernier code ; ils expirent. Un échec d’envoi ne contourne pas le second facteur.

L’activation ou la régénération affiche une seule fois des codes de récupération à usage unique. Conservez-les hors de CyTask, idéalement dans un gestionnaire de mots de passe. Les régénérer invalide les anciens.

En cas de perte, connectez-vous avec un code inutilisé puis remplacez le facteur depuis la sécurité du compte. L’opération peut demander mot de passe et nouvelle preuve valide. Il n’existe pas de réinitialisation anonyme ni de contournement automatique par l’administrateur.

## Politique et sessions {#policy-and-sessions}
La politique obligatoire bloque l’accès avant activation et empêche de retirer le dernier facteur utilisable. En mode facultatif, un compte ayant activé un facteur doit le fournir aux prochaines connexions. Une session valide ne redemande pas un code à chaque actualisation ; il n’existe pas d’exception distincte « appareil mémorisé ».

Le mode solo utilise sa connexion locale, pas la MFA interactive. Les tokens API et agents restent des identifiants séparés, sans demande TOTP à chaque appel.

Voir [administration](doc:administration) et [dépannage](doc:troubleshooting).
