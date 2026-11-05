---
id: calls
title: Vocal, vidéo et partage d’écran
section: Collaboration
order: 11
sourceRevision: 1
---

Les salons vocaux et vidéo proposent des appels WebRTC. La participation est explicite : ouvrir un salon n’active pas discrètement micro ou caméra.

## Rejoindre et contrôler l’appel {#join-and-control-a-call}
1. Ouvrez un salon vocal ou vidéo, puis Rejoindre.
2. Autorisez le microphone ; autorisez la caméra seulement pour envoyer une vidéo.
3. Utilisez les contrôles micro, écoute, caméra et périphériques.
4. Lancez séparément le partage d’écran, puis choisissez écran ou fenêtre dans le sélecteur natif du navigateur.
5. Arrêtez le partage ou quittez à la fin. Changer de salon ou fermer l’espace termine l’appel en cours.

Caméra et écran sont deux flux distincts. Le partage d’écran n’implique pas la capture du son système. Le droit de voir un projet n’autorise pas nécessairement à rejoindre un appel interactif.

## Conditions réseau {#network-requirements}
Un déploiement distant exige HTTPS pour accéder aux médias du navigateur. Le développement sur la boucle locale bénéficie d’une exception selon le navigateur. L’administrateur peut configurer STUN/TURN, notamment entre réseaux ou routeurs différents.

Sans relais adapté, un appel local peut fonctionner alors que des participants distants ne se connectent pas. Vérifiez d’abord l’autorisation du micro, puis réseau et configuration TURN.

## Capacité et limites {#capacity-and-limits}
L’implémentation utilise un maillage pair-à-pair. La limite par défaut est de 8 participants, avec un maximum de 16 ; ce n’est pas un SFU destiné aux grandes diffusions. Chaque participant supplémentaire augmente la charge réseau et machine.

Enregistrement, appels persistants en arrière-plan et partage garanti du son système ne sont pas proposés. Fermez les fenêtres inutiles et notifications personnelles avant de partager.

Voir [administration](doc:administration) et [dépannage](doc:troubleshooting).
