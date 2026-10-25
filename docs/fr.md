# Slack

## Présentation

Discutez avec Gladys sur **Slack**, en message privé avec un robot de votre propre espace de travail : Gladys y répond, et y envoie aussi ses notifications et ses images de caméra. Vos scènes peuvent réagir quand un membre lié écrit au robot, mentionne `@gladys` dans un canal ou tape `/gladys`, et publier elles-mêmes des messages Slack.

L’intégration utilise le **Socket Mode** : elle ouvre elle-même la connexion vers Slack, Gladys n’a donc besoin ni d’URL publique, ni de port ouvert, ni de Gladys Plus. Les messages passent par les serveurs de Slack (transport cloud). Intégration non officielle, sans lien avec Slack Technologies ; pas encore testée dans un vrai espace de travail.

## Prérequis

- Gladys Assistant 5.3.0 ou plus récent.
- Un espace de travail Slack où vous pouvez installer une app (sur certains espaces, un administrateur doit l’approuver).
- Un accès Internet depuis Gladys (sortant uniquement).

### Créer l’app Slack

1. Dans **Intégrations → Slack → Configuration**, ouvrez le lien **Créer l’app Gladys dans Slack** : Slack ouvre sa page de création d’app avec le manifeste ci-dessous déjà rempli. Choisissez votre espace de travail, vérifiez et cliquez sur **Create**.
2. Dans l’app, **Basic Information → App-Level Tokens → Generate Token and Scopes** : donnez-lui un nom, ajoutez la portée `connections:write`, générez, et copiez le jeton qui commence par `xapp-`.
3. **Install App → Install to Workspace**, autorisez, puis copiez le **Bot User OAuth Token**, qui commence par `xoxb-`.

Sans le lien : ouvrez [api.slack.com/apps](https://api.slack.com/apps), **Create New App → From a manifest**, choisissez l’espace de travail et collez ce manifeste (aussi dans [slack-app-manifest.json](https://github.com/William-De71/gladys-slack/blob/main/slack-app-manifest.json)) :

```json
{
  "_metadata": {
    "major_version": 1
  },
  "display_information": {
    "name": "Gladys",
    "description": "Gladys Assistant, the home automation assistant of the house.",
    "background_color": "#2f6fb5"
  },
  "features": {
    "app_home": {
      "home_tab_enabled": false,
      "messages_tab_enabled": true,
      "messages_tab_read_only_enabled": false
    },
    "bot_user": {
      "display_name": "gladys",
      "always_online": true
    },
    "slash_commands": [
      {
        "command": "/gladys",
        "description": "Talk to Gladys, or send a link code",
        "usage_hint": "turn on the kitchen light",
        "should_escape": false
      }
    ]
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "app_mentions:read",
        "channels:history",
        "channels:read",
        "chat:write",
        "commands",
        "files:write",
        "groups:history",
        "groups:read",
        "im:history",
        "im:write",
        "users:read"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "bot_events": ["app_mention", "message.channels", "message.groups", "message.im"]
    },
    "org_deploy_enabled": false,
    "socket_mode_enabled": true,
    "token_rotation_enabled": false
  }
}
```

L’app reste une app interne de votre espace de travail. Elle demande le plus petit ensemble d’autorisations dont l’intégration se sert : pas de jeton utilisateur, pas d’accès aux adresses e-mail, et aucune lecture de l’historique (les messages arrivent par événements).

## Configuration

| Champ                                | Rôle                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jeton du robot                       | `xoxb-…`, OAuth & Permissions → Bot User OAuth Token. Stocké chiffré.                                                                                                                                      |
| Jeton d’application                  | `xapp-…` avec la portée `connections:write`, Basic Information → App-Level Tokens. Stocké chiffré.                                                                                                         |
| Envoyer les messages privés à Gladys | Activé par défaut. Désactivé : les messages des membres liés n’atteignent que les scènes.                                                                                                                  |
| Canal par défaut                     | Facultatif. Un identifiant de canal (`C…`, tout en bas des détails du canal) ou de membre (`U…`), pour l’action de scène et le bouton de test. Invitez d’abord le robot dans ce canal (`/invite @gladys`). |
| Langue du robot                      | Les quelques textes que le robot écrit lui-même aux membres que Gladys ne connaît pas encore (invitation, code refusé).                                                                                    |

Enregistrez, puis appuyez sur **Tester la connexion** : il affiche l’espace de travail, le robot, l’état du Socket Mode, le canal par défaut (et si le robot y est) et le nombre de membres liés.

### Lier votre compte Slack

Chaque utilisateur le fait une fois : dans **Intégrations → Slack → Configuration**, bloc **Lier mon compte**, cliquez sur **Générer un code de liaison**, puis dans Slack envoyez le code à `@gladys` en message privé (Apps → Gladys → Messages), ou tapez `/gladys` suivi du code n’importe où. Le robot répond que le compte est lié. Le code est valable 15 minutes, une seule fois.

Un membre non lié reçoit seulement une invitation à se lier (une fois par jour) : il n’atteint jamais Gladys ni les scènes. Ne liez que des personnes de confiance : un membre lié parle avec l’autorité de son utilisateur Gladys.

## Utilisation

### Discuter avec Gladys

Écrivez à `@gladys` en message privé, comme dans le chat de Gladys : « allume la lumière de la cuisine », « quelle température fait-il dans le salon ? ». Gladys répond dans la même conversation. `/gladys <demande>` fonctionne depuis n’importe quel canal ; la réponse arrive dans le message privé, et vous seul voyez l’accusé de réception. Gladys y envoie aussi les notifications de vos scènes (« Envoyer un message » à un utilisateur) et les images de caméra (« Envoyer une image de caméra »).

Les messages des autres robots, les modifications, les messages renvoyés par Slack et les messages de plus de 5 minutes (après une coupure) sont ignorés.

### Widget de tableau de bord

![Le widget Slack : messages du jour, membres liés, derniers messages, connexion et bouton de test (illustration générée, pas une capture d’écran)](https://raw.githubusercontent.com/William-De71/gladys-slack/main/docs/assets/widgets.fr.png)

Illustration générée, pas une capture d’écran. Le widget **Slack** affiche les messages reçus et envoyés aujourd’hui, les membres liés, les derniers messages des membres liés, la connexion, l’espace de travail, le robot et le canal par défaut, avec un bouton **Envoyer un test**. Le texte des messages n’apparaît que si le réglage du widget **Afficher le texte des messages** est activé (désactivé par défaut : un tableau de bord peut être partagé).

### Scènes

Déclencheurs, pour les membres liés uniquement :

- **Message Slack reçu** : un message privé au robot, ou un message dans un canal où le robot a été invité. Filtres : où, canal, membre, utilisateur Gladys, texte exact.
- **Gladys mentionnée sur Slack** : `@gladys` dans un canal ; le texte sans la mention. Mêmes filtres.
- **Commande /gladys tapée** : filtres canal, membre, utilisateur Gladys, texte exact.
- **Message Slack non envoyé** : un message de Gladys a été refusé ; une fois par membre, jusqu’à ce qu’un message repasse.

Chaque déclencheur fournit ses détails en variables, par exemple `{{triggerEvent.data.text}}`, `{{triggerEvent.data.first_name}}`, `{{triggerEvent.data.ts}}`.

Action **Envoyer un message Slack** : un identifiant de canal ou de membre (vide : le canal par défaut), le texte en mise en forme Slack (`*gras*`, `<@U0123456789>`, `<https://example.com|un lien>`), et un fil facultatif. Sorties : `ts`, `channel_id`, `link`.

Exemples :

- `@gladys éteins tout` dans `#maison` → éteindre les lumières, puis envoyer « C’est fait ✅ » dans le fil `{{triggerEvent.data.ts}}`.
- `/gladys bonne nuit` → lancer la scène de nuit.
- La porte d’entrée s’ouvre alors que personne n’est là → envoyer un message dans `#maison` et une image de caméra aux utilisateurs liés.

## Dépannage

- **« Saisissez le jeton du robot… » / « doit commencer par xoxb- »** : le jeton du robot est le Bot User OAuth Token (`xoxb-`), pas un jeton utilisateur (`xoxp-`) ; le jeton d’application commence par `xapp-`, pas par `xoxe.xapp-` (laissez la rotation des jetons désactivée).
- **« Slack refuse le jeton du robot »** : recopiez-le depuis OAuth & Permissions ; réinstallez l’app après avoir changé ses portées.
- **« Slack refuse le jeton d’application »** : il lui faut la portée `connections:write`.
- **« Le Socket Mode est désactivé »** : Settings → Socket Mode dans l’app Slack.
- **Le robot ne répond pas à un message privé** : le compte est-il lié ? « Envoyer les messages privés à Gladys » est-il activé ? Dans l’app, App Home → « Allow users to send Slash commands and messages from the messages tab » doit être coché (c’est le cas dans le manifeste).
- **Aucun déclencheur depuis un canal** : invitez le robot avec `/invite @gladys` ; seuls les membres liés déclenchent des scènes.
- **« not_in_channel »** sur l’action de scène : invitez le robot dans le canal. Un nom de canal ne fonctionne pas : utilisez son identifiant.
- Signalez un problème sur [GitHub](https://github.com/William-De71/gladys-slack/issues) avec les versions de Gladys et de l’intégration, le message de **Tester la connexion** et les journaux (`DEBUG=gladys-integration-sdk`). Ne collez jamais un jeton.
