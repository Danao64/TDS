# Planning TDS — générateur de planning équitable

Application web statique (HTML/JS, sans serveur) pour générer le planning mensuel d'une équipe en cycle
(J1 → J2 → J3/nuit → OFF…) avec statistiques d'équité. Les données restent **dans le navigateur** (localStorage).

## Mettre en ligne sur GitHub Pages

1. Créez un dépôt GitHub (ex. `planning-tds`) et déposez-y tous les fichiers de ce dossier à la racine :
   `index.html`, `app.js`, `planner.js`, `style.css`, `README.md`, `tests/`.
2. **Settings → Pages → Build and deployment** : Source = *Deploy from a branch*, branche `main`, dossier `/ (root)`.
3. Après quelques minutes, l'appli est disponible sur `https://<utilisateur>.github.io/planning-tds/`.

> ⚠ Un dépôt public rend le **code** public, pas vos données (elles ne quittent jamais votre navigateur).
> Ne commitez jamais une sauvegarde JSON exportée : elle contient les plannings nominatifs.
> L'export/import Excel utilise SheetJS chargé depuis cdnjs (connexion requise) ; CSV et JSON fonctionnent hors ligne.

## Utilisation

1. **Paramètres** : trigrammes des agents, renforts, compteurs de départ, date d'ancrage du cycle, périodes d'option (J0), effectif minimum, pondérations.
2. **Demandes** : congés, récups, formations, souhaits/évitements, créneaux imposés — saisie ou import CSV/XLSX (modèle téléchargeable).
3. **Planning** : choisir le mois → *Générer*. Alertes (effectif < minimum…), échange manuel de deux agents (jour verrouillé 🔒, conservé à la régénération), export CSV/Excel.
4. **Statistiques** : cumul par agent (heures, nuits, soirées, nuits WE/férié, J2 tardifs, débuts tôt, J0…) avec écart au taux d'équipe.
5. **Données** : sauvegarde / restauration JSON. Générez les mois dans l'ordre : chaque mois s'appuie sur les compteurs des précédents.

## Règles implémentées

- Cycle de 6 jours : J1, J2, J3, OFF, OFF, OFF, jamais modifié ; en période d'option, le dernier OFF avant chaque J1 devient J0 (un agent, à tour de rôle).
- **Chef de tour (CDT)** : case dans Paramètres (et type de demande « Chef de tour » pour une période). Les vacations de rang 1 (J1-1, J2-1, J3-1) sont obligatoirement attribuées à un CDT ; si aucun CDT n'est disponible ce jour-là, la règle ne peut pas être tenue et une alerte est affichée (idem après un échange manuel qui la contredit).
- **Renforts** : jamais planifiés, sauf les jours saisis dans Demandes (type « Renfort disponible »).
- Tous les agents disponibles travaillent chaque jour de cycle ; les horaires sont attribués dans l'ordre de rang (J1-1, J1-2…) selon le nombre de présents ; J3 : les 3 premiers rangs font la nuit effective, les suivants la soirée.
- Grilles horaires distinctes lundi–vendredi / samedi / dimanche et fériés (fériés français calculés automatiquement).
- **Nuit (J3)** : parmi les agents de nuit (rangs 1 à 3), un seul fait la **N1** (reste éveillé, affichée « J3-X 🌙 ») et un autre le **repas** (« J3-X 🍴 ») ; ce sont toujours deux agents différents. Compteurs séparés N1 et repas, répartis à l'équité par nuit effectuée ; la N1 pèse plus que les nuits classiques (pondération 8 contre 4, réglable).
- **J2 tôt la veille d'une nuit** (dans la mesure du possible) : la veille d'un J3, l'équipe de nuit du lendemain est prévue à l'avance et reçoit en priorité les J2 « tôt » (début au plus tard à 10:00, réglable). Règle souple : elle dépend du nombre de J2 tôt de la grille et des absences.
- **Pas de J0 après une N1** : le J0 de fin de cycle n'est jamais donné à l'agent qui a fait la N1 du J3 du même cycle (sauf s'il est le seul disponible, avec alerte).
- **Échange manuel** : seules les vacations des deux agents sont verrouillées (🔒) et conservées à la régénération ; le reste du jour est recalculé autour.
- Affectation par optimisation (algorithme hongrois) : à chaque jour, l'agent le plus « en dessous » du taux d'équipe reçoit les vacations les plus lourdes. L'équité est mesurée **par jour travaillé**, pour ne pas pénaliser (ni favoriser) les agents en congé.
- Souhaits/évitements : priorité forte mais pas absolue ; le décompte « souhaits OK / KO » est visible dans les statistiques. Valeurs possibles : `nuit`, `soiree`, `tot`, `tard`, `j0`. Pour le J0, un souhait ou un évitement compte pour 2 J0 d'écart avec l'agent le moins servi (la demande passe avant l'équité dans cette limite) ; un créneau imposé `J0` force l'agent ce jour-là.

## Tests

`node tests/test.js` simule un an complet (7 agents, congés aléatoires, période d'option) et vérifie les invariants.

## Limites connues

- Les « heures » sont les durées brutes des vacations ; le total de votre fichier Excel peut suivre une autre convention (pauses, crédits).
- Le cycle se déroule depuis la date d'ancrage ; après des changements d'équipe/cycle, ajustez l'ancrage.
- Pas de contrôle réglementaire automatique (repos minimal, plafonds) : à ajouter si besoin.
