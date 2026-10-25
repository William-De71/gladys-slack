# Slack

## Überblick

Schreib mit Gladys auf **Slack**, per Direktnachricht an einen Bot deines eigenen Workspace: Gladys antwortet dort und schickt dorthin auch ihre Benachrichtigungen und Kamerabilder. Deine Szenen können reagieren, wenn ein verknüpftes Mitglied dem Bot schreibt, `@gladys` in einem Kanal erwähnt oder `/gladys` eingibt, und selbst Slack-Nachrichten posten.

Die Integration nutzt den **Socket Mode**: Sie öffnet die Verbindung zu Slack selbst, Gladys braucht also keine öffentliche URL, keinen offenen Port und kein Gladys Plus. Die Nachrichten laufen über die Server von Slack (Cloud-Transport). Inoffizielle Integration, ohne Verbindung zu Slack Technologies; noch nicht in einem echten Workspace getestet.

## Voraussetzungen

- Gladys Assistant 5.3.0 oder neuer.
- Ein Slack-Workspace, in dem du eine App installieren darfst (in manchen Workspaces muss ein Admin sie genehmigen).
- Internetzugang von Gladys aus (nur ausgehend).

### Slack-App erstellen

1. Öffne unter **Integrationen → Slack → Konfiguration** den Link **Gladys-App in Slack erstellen**: Slack öffnet seine App-Erstellungsseite mit dem Manifest unten bereits ausgefüllt. Wähle deinen Workspace, prüfe und klicke auf **Create**.
2. In der App: **Basic Information → App-Level Tokens → Generate Token and Scopes**: Gib einen Namen ein, füge den Scope `connections:write` hinzu, erzeuge das Token und kopiere es (es beginnt mit `xapp-`).
3. **Install App → Install to Workspace**, erlauben, dann das **Bot User OAuth Token** kopieren, das mit `xoxb-` beginnt.

Ohne den Link: Öffne [api.slack.com/apps](https://api.slack.com/apps), **Create New App → From a manifest**, wähle den Workspace und füge dieses Manifest ein (auch in [slack-app-manifest.json](https://github.com/William-De71/gladys-slack/blob/main/slack-app-manifest.json)):

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

Die App bleibt eine interne App deines Workspace. Sie verlangt die kleinste Menge an Berechtigungen, die die Integration nutzt: kein Benutzer-Token, kein Zugriff auf E-Mail-Adressen und kein Lesen des Verlaufs (Nachrichten kommen als Ereignisse).

## Konfiguration

| Feld                               | Bedeutung                                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bot-Token                          | `xoxb-…`, OAuth & Permissions → Bot User OAuth Token. Verschlüsselt gespeichert.                                                                                                                       |
| App-Level-Token                    | `xapp-…` mit dem Scope `connections:write`, Basic Information → App-Level Tokens. Verschlüsselt gespeichert.                                                                                           |
| Direktnachrichten an Gladys senden | Standardmäßig an. Aus: Nachrichten verknüpfter Mitglieder erreichen nur die Szenen.                                                                                                                    |
| Standardkanal                      | Optional. Eine Kanal-ID (`C…`, ganz unten in den Kanaldetails) oder eine Mitglieds-ID (`U…`) für die Szenenaktion und die Test-Schaltfläche. Lade den Bot zuerst in den Kanal ein (`/invite @gladys`). |
| Sprache des Bots                   | Die wenigen Texte, die der Bot selbst an Mitglieder schreibt, die Gladys noch nicht kennt (Einladung, abgelehnter Code).                                                                               |

Speichere und drücke dann **Verbindung testen**: Es zeigt den Workspace, den Bot, den Zustand des Socket Mode, den Standardkanal (und ob der Bot darin ist) und die Anzahl verknüpfter Mitglieder.

### Dein Slack-Konto verknüpfen

Jeder Benutzer macht es einmal: Klicke unter **Integrationen → Slack → Konfiguration** im Block **Mein Konto verknüpfen** auf **Verknüpfungscode generieren** und sende den Code dann in Slack per Direktnachricht an `@gladys` (Apps → Gladys → Nachrichten) oder gib irgendwo `/gladys` gefolgt vom Code ein. Der Bot antwortet, dass das Konto verknüpft ist. Der Code gilt 15 Minuten, einmal.

Ein nicht verknüpftes Mitglied erhält nur eine Einladung zum Verknüpfen (einmal am Tag): Es erreicht nie Gladys oder die Szenen. Verknüpfe nur Personen, denen du vertraust: Ein verknüpftes Mitglied spricht mit den Befugnissen seines Gladys-Benutzers.

## Verwendung

### Mit Gladys schreiben

Schreib `@gladys` per Direktnachricht wie im Chat von Gladys: „mach das Licht in der Küche an“, „wie warm ist es im Wohnzimmer?“. Gladys antwortet in derselben Unterhaltung. `/gladys <Bitte>` funktioniert aus jedem Kanal; die Antwort kommt per Direktnachricht, und nur du siehst die Bestätigung. Gladys schickt dorthin auch die Benachrichtigungen deiner Szenen („Nachricht senden“ an einen Benutzer) und Kamerabilder („Kamerabild senden“).

Nachrichten anderer Bots, Bearbeitungen, von Slack erneut zugestellte Nachrichten und Nachrichten, die älter als 5 Minuten sind (nach einem Ausfall), werden ignoriert.

### Dashboard-Widget

![Das Slack-Widget: Nachrichten des Tages, verknüpfte Mitglieder, letzte Nachrichten, Verbindung und Test-Schaltfläche (generierte Illustration, kein Screenshot)](https://raw.githubusercontent.com/William-De71/gladys-slack/main/docs/assets/widgets.de.png)

Generierte Illustration, kein Screenshot. Das Widget **Slack** zeigt die heute empfangenen und gesendeten Nachrichten, die verknüpften Mitglieder, die letzten Nachrichten verknüpfter Mitglieder, die Verbindung, den Workspace, den Bot und den Standardkanal, mit einer Schaltfläche **Test senden**. Der Text der Nachrichten erscheint nur, wenn die Widget-Einstellung **Text der Nachrichten anzeigen** an ist (standardmäßig aus: Ein Dashboard kann geteilt sein).

### Szenen

Auslöser, nur für verknüpfte Mitglieder:

- **Slack-Nachricht empfangen**: eine Direktnachricht an den Bot oder eine Nachricht in einem Kanal, in den der Bot eingeladen wurde. Filter: wo, Kanal, Mitglied, Gladys-Benutzer, genauer Text.
- **Gladys auf Slack erwähnt**: `@gladys` in einem Kanal; der Text ohne die Erwähnung. Dieselben Filter.
- **/gladys-Befehl eingegeben**: Filter Kanal, Mitglied, Gladys-Benutzer, genauer Text.
- **Slack-Nachricht nicht gesendet**: Eine Nachricht von Gladys wurde abgelehnt; einmal pro Mitglied, bis wieder eine Nachricht durchgeht.

Jeder Auslöser liefert seine Details als Variablen, z. B. `{{triggerEvent.data.text}}`, `{{triggerEvent.data.first_name}}`, `{{triggerEvent.data.ts}}`.

Aktion **Slack-Nachricht senden**: eine Kanal-ID oder eine Mitglieds-ID (leer: der Standardkanal), der Text mit Slack-Formatierung (`*fett*`, `<@U0123456789>`, `<https://example.com|ein Link>`) und ein optionaler Thread. Ausgaben: `ts`, `channel_id`, `link`.

Beispiele:

- `@gladys Licht aus` in `#zuhause` → die Lichter ausschalten, dann „Erledigt ✅“ im Thread `{{triggerEvent.data.ts}}` senden.
- `/gladys gute Nacht` → die Nachtszene starten.
- Die Haustür geht auf, während niemand zu Hause ist → eine Nachricht an `#zuhause` und ein Kamerabild an die verknüpften Benutzer senden.

## Fehlerbehebung

- **„Gib das Bot-Token… ein“ / „muss mit xoxb- beginnen“**: Das Bot-Token ist das Bot User OAuth Token (`xoxb-`), kein Benutzer-Token (`xoxp-`); das App-Level-Token beginnt mit `xapp-`, nicht mit `xoxe.xapp-` (lass die Token-Rotation aus).
- **„Slack lehnt das Bot-Token ab“**: Kopiere es erneut unter OAuth & Permissions; installiere die App nach einer Änderung der Scopes neu.
- **„Slack lehnt das App-Level-Token ab“**: Es braucht den Scope `connections:write`.
- **„Der Socket Mode ist ausgeschaltet“**: Settings → Socket Mode in der Slack-App.
- **Der Bot antwortet nicht auf eine Direktnachricht**: Ist das Konto verknüpft? Ist „Direktnachrichten an Gladys senden“ an? In der App muss unter App Home „Allow users to send Slash commands and messages from the messages tab“ angehakt sein (im Manifest der Fall).
- **Kein Auslöser aus einem Kanal**: Lade den Bot mit `/invite @gladys` ein; nur verknüpfte Mitglieder lösen Szenen aus.
- **„not_in_channel“** bei der Szenenaktion: Lade den Bot in den Kanal ein. Ein Kanalname funktioniert nicht: Nutze seine ID.
- Melde ein Problem auf [GitHub](https://github.com/William-De71/gladys-slack/issues) mit den Versionen von Gladys und der Integration, der Meldung von **Verbindung testen** und den Protokollen (`DEBUG=gladys-integration-sdk`). Füge nie ein Token ein.
