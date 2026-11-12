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

## Sauvegarde et mois à régénérer
- **Rappel de sauvegarde** : les données ne vivent que dans le navigateur. Un bandeau « 💾 Sauvegarde conseillée » apparaît après chaque génération ou échange, au bout de 7 jours sans export, ou tant qu'aucune sauvegarde n'a été faite. Le bouton du bandeau télécharge `planning-tds-sauvegarde-AAAA-MM-JJ.json` ; la date du dernier export est affichée dans l'onglet Données.
- **Mois à régénérer** : chaque mois s'appuie sur les compteurs des précédents. Dès qu'un mois généré devient faux (un mois précédent régénéré, un échange, une demande ajoutée / modifiée / supprimée, des paramètres modifiés), un bandeau « ⚠ À régénérer » liste les mois concernés et leur raison. Le bouton « Régénérer dans l'ordre » les recalcule tous, du plus ancien au plus récent, en conservant journées figées et échanges. Modifier la note ou la case « déposée » d'une demande ne déclenche rien.

## Règles implémentées

- Cycle de 6 jours : J1, J2, J3, OFF, OFF, OFF, jamais modifié ; en période d'option, le dernier OFF avant chaque J1 devient J0 (un agent, à tour de rôle).
- **Chef de tour (CDT)** : case dans Paramètres (et type de demande « Chef de tour » pour une période). Les vacations de rang 1 (J1-1, J2-1, J3-1) sont obligatoirement attribuées à un CDT ; si aucun CDT n'est disponible ce jour-là, la règle ne peut pas être tenue et une alerte est affichée (idem après un échange manuel qui la contredit).
- **Renforts** : jamais planifiés, sauf les jours saisis dans Demandes (type « Renfort disponible »).
- Tous les agents disponibles travaillent chaque jour de cycle ; les horaires sont attribués dans l'ordre de rang (J1-1, J1-2…) selon le nombre de présents ; J3 : les 3 premiers rangs font la nuit effective, les suivants la soirée.
- Grilles horaires distinctes lundi–vendredi / samedi / dimanche et fériés (fériés français calculés automatiquement).
- **Nuit (J3)** : parmi les agents de nuit (rangs 1 à 3), un seul fait la **N1** (reste éveillé, affichée par un croissant de lune jaune sous la vacation) et un autre le **repas** (assiette blanche entre fourchette et couteau ; 🍽️ dans les listes) ; ce sont toujours deux agents différents. Compteurs séparés N1 et repas. La **N1 et le repas sont répartis à égalité entre tous les agents**, par jour travaillé : un chef de tour en fait autant qu'un autre agent, même s'il fait plus de nuits ; la N1 pèse plus que les nuits classiques (pondération 8 contre 4, réglable). Les cases J3 ont un fond bleu nuit pour que ces symboles ressortent.
- **J2 tôt la veille d'une nuit** (dans la mesure du possible) : la veille d'un J3, l'équipe de nuit du lendemain est prévue à l'avance et reçoit en priorité les J2 « tôt » (début au plus tard à 10:00, réglable). Règle souple : elle dépend du nombre de J2 tôt de la grille et des absences.
- **Pas de J0 après une N1** : le J0 de fin de cycle n'est jamais donné à l'agent qui a fait la N1 du J3 du même cycle (sauf s'il est le seul disponible, avec alerte).
- **Journées figées ❄** : case « Figer » sous chaque jour (ou « Figer jusqu'au… », « Tout figer ») ; une journée figée est conservée à l'identique (vacations, N1, repas, échanges) quand on régénère le mois, le reste est recalculé autour. Une alerte signale une journée figée devenue incohérente avec les demandes (agent devenu indisponible).
- **Paramètres : CDT en premier** : la liste des agents place les chefs de tour en tête, chacun par ordre d'inscription (premier inscrit, première ligne), puis les autres agents dans leur ordre d'inscription. Même ordre dans la grille du planning.
- **Bandeau du mois** : un bandeau « DÉCEMBRE 2026 » s'affiche juste au-dessus du tableau de service.
- **Effacer ce mois** (onglet Planning, bouton 🗑) : supprime le planning du mois affiché (vacations, journées figées, échanges) après confirmation. Les demandes et les paramètres sont conservés ; les mois suivants passent « à régénérer ». Pensez à exporter une sauvegarde avant si vous voulez pouvoir revenir en arrière.
- **Planning individuel** (onglet Planning, sous le tableau) : choisir un agent pour voir ses vacations du mois (date, vacation, horaires, N1 / repas, absences). « Imprimer / PDF » n'imprime que cette fiche. « Calendrier (.ics) » exporte le mois, ou tous les mois générés, en fichier à importer dans le calendrier du téléphone ; les nuits finissent bien le lendemain matin, les absences sont des journées entières. Réimporter un fichier met à jour les vacations déjà importées.
- **Export PDF** : bouton « 📄 Exporter en PDF » (onglet Planning) ; n'imprime que le planning du mois affiché (A4 paysage, une page, sans menus ni cases à cocher). Les vacations J1-1, J2-1, J3-1 y sont notées « J1 CDT », « J2 CDT », « J3 CDT » ; à l'écran comme dans le PDF, les symboles lune et assiette occupent une ligne sous la vacation, les horaires la ligne suivante. Dans la fenêtre d'impression du navigateur, choisir « Enregistrer au format PDF ». Le fichier est proposé sous le nom « Planning DÉCEMBRE 2026 ».
- **Thème** : bouton clair / sombre en haut à droite, mémorisé dans le navigateur (par défaut, le thème du système).
- **Échange manuel** : seules les vacations des deux agents sont verrouillées (🔒) et conservées à la régénération ; le reste du jour est recalculé autour.
- **Crédit d'absence** (Paramètres, 1 par défaut) : pour l'équité des nuits, N1, repas, soirées, etc., un jour d'absence compte comme un jour de présence ; un agent absent (congé, récup) rattrape donc ensuite son retard au lieu de le garder. Les heures ne sont pas concernées. À 0, seule la présence compte.
- **Rythme de rattrapage (équité sur l'année)** : un agent en retard (congés en début d'année, absence longue) rattrape progressivement, pas en un mois : **au plus 3 nuits par agent et par mois**, **une N1 par mois**, une 2e N1 seulement exceptionnellement, jamais plus de 2. L'objectif est l'équilibre en fin d'année : un agent qui pose beaucoup de congés tôt en pose moins ensuite, et rattrape au fil des mois. Plafonds et poids de la 2e N1 réglables dans Paramètres ; un dépassement inévitable (effectif insuffisant) est signalé en alerte. En simulation (7 semaines de congés en janvier-février), l'agent concerné fait 3 nuits par mois au retour puis revient à la normale, et finit l'année à moins de 2 nuits de l'équilibre.
- Affectation par optimisation (algorithme hongrois) : à chaque jour, l'agent le plus « en dessous » du taux d'équipe reçoit les vacations les plus lourdes. L'équité est mesurée **par jour travaillé**, pour ne pas pénaliser (ni favoriser) les agents en congé.
- **Lissage du mois** : une fois le mois affecté jour par jour, le moteur le reprend en entier et échange des vacations (ou la N1 / le repas) entre deux agents d'un même jour tant que cela réduit les écarts au taux d'équipe. Il ne touche ni aux journées figées, ni aux vacations verrouillées 🔒 ou imposées, ni au rang 1 chef de tour, ni à la règle « pas de J0 après une N1 » ; souhaits et J2 tôt la veille d'une nuit gardent leur poids. Effet mesuré en simulation : écart d'heures entre agents réduit d'environ 40 %, autres écarts d'environ 10 %. Les écarts restants entre chefs de tour et autres agents (nuits, soirées, J2 tardifs) viennent de l'obligation de tenir les J1-1 / J2-1 / J3-1 : ils ne peuvent pas être lissés.
- Souhaits/évitements : priorité forte mais pas absolue ; le décompte « souhaits OK / KO » est visible dans les statistiques. Valeurs possibles : `nuit`, `soiree`, `tot`, `tard`, `j0`. Pour le J0, un souhait ou un évitement compte pour 2 J0 d'écart avec l'agent le moins servi (la demande passe avant l'équité dans cette limite) ; un créneau imposé `J0` force l'agent ce jour-là.

## Demandes : tri et mail de dépôt

- Les demandes les plus récentes s'affichent **en haut** de la liste (un lot importé arrive en haut, dans l'ordre du fichier).
- Case **Déposée** par demande : permet de suivre ce qui a déjà été transmis.
- Bouton **✉ Générer le mail de dépôt** : produit l'objet et le corps d'un mail listant les congés, récupérations, formations et autres absences (filtrables par type, par période, et « non déposées » seulement), avec pour chaque demande les dates et le nombre de vacations de cycle (J1/J2/J3) concernées. Le texte reste modifiable ; boutons Copier, Ouvrir dans la messagerie (le destinataire se saisit dans le mail) et Marquer comme déposées. Formule d'appel et signature sont mémorisées dans le navigateur.

## Tests

`node tests/test.js` simule un an complet (7 agents, congés aléatoires, période d'option) et vérifie les invariants.

## Limites connues

- Les « heures » sont les durées brutes des vacations ; le total de votre fichier Excel peut suivre une autre convention (pauses, crédits).
- Le cycle se déroule depuis la date d'ancrage ; après des changements d'équipe/cycle, ajustez l'ancrage.
- Pas de contrôle réglementaire automatique (repos minimal, plafonds) : à ajouter si besoin.
