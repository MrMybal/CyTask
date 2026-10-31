# Bienvenue dans CyMD

CyMD est un bloc-notes **Markdown** : vous écrivez du texte simple, et il s'affiche mis en forme *en direct*, comme sur Discord. La syntaxe reste masquée en Live, même pendant la sélection. Utilisez les vues Brut ou Côte à côte pour modifier les balises ou la structure des tableaux.

## Les quatre vues

- **Live** (Ctrl+1) : le rendu se fait directement pendant la frappe. C'est la vue par défaut.
- **Côte à côte** (Ctrl+2) : le Markdown brut à gauche, le résultat à droite.
- **Brut** (Ctrl+3) : le texte seul, comme dans le Bloc-notes.
- **Lecture** (Ctrl+4) : le document rendu, sans risque de le modifier. Double-cliquez pour revenir à l'édition.

## Onglets

Chaque document s'ouvre dans un **onglet**, comme dans Chrome : Ctrl+T (nouveau), Ctrl+W (fermer), Ctrl+Tab (suivant).
Glissez un onglet pour le réordonner, vers **une autre fenêtre** CyMD, ou **hors de la fenêtre** pour l'ouvrir dans une nouvelle fenêtre.
Un fichier ouvert depuis l'explorateur arrive en onglet dans la fenêtre déjà ouverte.

## Mise en forme

La barre d'outils en haut regroupe les fichiers et la mise en forme. **Sélectionnez du texte** : une petite barre apparaît juste au-dessus, comme sur Discord.

Du texte en **gras** (Ctrl+B), en *italique* (Ctrl+I), <u>souligné</u> (Ctrl+U), ~~barré~~ (Ctrl+Shift+X) ou en `code` (Ctrl+E).
Un ||spoiler|| se révèle au survol ou au clic, et un <mark>surlignage</mark> ou une touche <kbd>Ctrl</kbd> s'écrivent en HTML.
Un [lien avec un texte](https://fr.wikipedia.org/wiki/Markdown) (Ctrl+K). Ctrl+clic pour l'ouvrir.
Les numéros de ligne s'affichent avec le bouton **#** de la barre d'outils.

> Une citation commence par `>`.
> Elle peut tenir sur plusieurs lignes.

1. Une liste numérotée
2. Continue toute seule avec Entrée
   - et s'imbrique avec Tab

- [x] Une tâche terminée
- [ ] Une tâche à faire : cliquez sur la case

| Raccourci | Action |
| --- | --- |
| Ctrl+S | Enregistrer |
| Ctrl+T / Ctrl+W | Nouvel onglet / fermer l'onglet |
| Ctrl+Shift+V | Coller en texte brut |
| Ctrl+F | Rechercher / remplacer |

```js
// Les blocs de code sont colorés selon le langage
const salut = (nom) => `Bonjour ${nom} !`
```

---

## Images, vidéos et copier-coller

- **Collez une image** (capture d'écran, image copiée depuis le web) : elle est ajoutée au document.
- **Glissez-déposez** des images, vidéos ou fichiers dans la fenêtre.
- **Collez du contenu d'une page web ou de Word** : il est converti en Markdown.
- **Collez une URL sur du texte sélectionné** : cela crée un lien.
- Taille d'image : `![légende|300](image.png)` affiche l'image sur 300 pixels de large.

## Aperçus de liens

Une adresse web seule sur sa ligne affiche un aperçu, comme sur Discord :

https://fr.wikipedia.org/wiki/Markdown

Pour ne pas afficher d'aperçu, entourez l'adresse de chevrons : <https://fr.wikipedia.org/wiki/Markdown>

## Deux façons d'enregistrer

**Markdown simple (.md)** : un fichier texte standard, lisible partout. Les images et vidéos sont lues dans le dossier du fichier et ses sous-dossiers (`![photo](images/photo.jpg)`). Les médias collés sont enregistrés dans un sous-dossier `assets/` à côté du fichier.

**Document tout-en-un (.cymd)** : le texte, les images, les vidéos et les aperçus de liens réunis dans un seul fichier, facile à partager. Les aperçus restent visibles même sans connexion. C'est une archive ZIP : on peut l'ouvrir avec 7-Zip pour récupérer le Markdown.

Choisissez le format dans *Fichier → Enregistrer sous*.
