// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: the connection status of the Configuration screen, the result of
// its button, the replies the bot writes itself in Slack (before Gladys knows
// the member), the widget contents and toasts. Vocabulary of the Gladys
// interface ("Link my account", "Generate a link code", Integrations →
// Slack → Configuration; German says "du" like the Gladys interface, Spanish
// says "usted") and of Slack (workspace / espace de travail / Workspace /
// espacio de trabajo, member / membre / Mitglied / miembro).
// -----------------------------------------------------------------------------

import { LANGUAGES } from './config.js';

const TEXTS = {
  // --- connection status (setConnectionStatus, 200 characters) -----------------
  statusMissing: {
    en: 'Enter the bot token (xoxb-…) and the app-level token (xapp-…) of your Slack app.',
    fr: 'Saisissez le jeton du robot (xoxb-…) et le jeton d’application (xapp-…) de votre app Slack.',
    de: 'Gib das Bot-Token (xoxb-…) und das App-Level-Token (xapp-…) deiner Slack-App ein.',
    es: 'Introduzca el token del bot (xoxb-…) y el token de aplicación (xapp-…) de su app de Slack.',
  },
  statusBotFormat: {
    en: 'The bot token must start with xoxb- (OAuth & Permissions → Bot User OAuth Token).',
    fr: 'Le jeton du robot doit commencer par xoxb- (OAuth & Permissions → Bot User OAuth Token).',
    de: 'Das Bot-Token muss mit xoxb- beginnen (OAuth & Permissions → Bot User OAuth Token).',
    es: 'El token del bot debe empezar por xoxb- (OAuth & Permissions → Bot User OAuth Token).',
  },
  statusAppFormat: {
    en: 'The app-level token must start with xapp- (Basic Information → App-Level Tokens).',
    fr: 'Le jeton d’application doit commencer par xapp- (Basic Information → App-Level Tokens).',
    de: 'Das App-Level-Token muss mit xapp- beginnen (Basic Information → App-Level Tokens).',
    es: 'El token de aplicación debe empezar por xapp- (Basic Information → App-Level Tokens).',
  },
  statusConnected: {
    en: 'Connected to the Slack workspace {team} as @{bot}.',
    fr: 'Connecté à l’espace de travail Slack {team} en tant que @{bot}.',
    de: 'Mit dem Slack-Workspace {team} als @{bot} verbunden.',
    es: 'Conectado al espacio de trabajo de Slack {team} como @{bot}.',
  },
  statusBotRefused: {
    en: 'Slack refuses the bot token ({error}): copy it again from OAuth & Permissions, or reinstall the app.',
    fr: 'Slack refuse le jeton du robot ({error}) : recopiez-le depuis OAuth & Permissions, ou réinstallez l’app.',
    de: 'Slack lehnt das Bot-Token ab ({error}): Kopiere es erneut unter OAuth & Permissions oder installiere die App neu.',
    es: 'Slack rechaza el token del bot ({error}): cópielo de nuevo en OAuth & Permissions o reinstale la app.',
  },
  statusAppRefused: {
    en: 'Slack refuses the app-level token ({error}): it needs the connections:write scope.',
    fr: 'Slack refuse le jeton d’application ({error}) : il lui faut la portée connections:write.',
    de: 'Slack lehnt das App-Level-Token ab ({error}): Es braucht den Scope connections:write.',
    es: 'Slack rechaza el token de aplicación ({error}): necesita el permiso connections:write.',
  },
  statusSocketDisabled: {
    en: 'Socket Mode is turned off in the Slack app: turn it on again (Settings → Socket Mode).',
    fr: 'Le Socket Mode est désactivé dans l’app Slack : réactivez-le (Settings → Socket Mode).',
    de: 'Der Socket Mode ist in der Slack-App ausgeschaltet: Schalte ihn wieder ein (Settings → Socket Mode).',
    es: 'El Socket Mode está desactivado en la app de Slack: vuelva a activarlo (Settings → Socket Mode).',
  },
  statusReconnecting: {
    en: 'Connection to Slack lost: reconnecting.',
    fr: 'Connexion à Slack perdue : reconnexion en cours.',
    de: 'Verbindung zu Slack verloren: Neuverbindung läuft.',
    es: 'Conexión con Slack perdida: reconectando.',
  },
  statusUnreachable: {
    en: 'Slack does not answer: check the internet connection of Gladys.',
    fr: 'Slack ne répond pas : vérifiez la connexion Internet de Gladys.',
    de: 'Slack antwortet nicht: Prüfe die Internetverbindung von Gladys.',
    es: 'Slack no responde: compruebe la conexión a Internet de Gladys.',
  },
  statusError: {
    en: 'Slack answered an error ({error}): see the logs of the integration.',
    fr: 'Slack a répondu une erreur ({error}) : voir les journaux de l’intégration.',
    de: 'Slack hat einen Fehler gemeldet ({error}): siehe Protokolle der Integration.',
    es: 'Slack respondió un error ({error}): consulte los registros de la integración.',
  },

  // --- the "Test the connection" button -----------------------------------------
  testOk: {
    en: 'Workspace {team}, bot @{bot}. Socket Mode: {socket}. Default channel: {channel}. Linked members: {members}.',
    fr: 'Espace de travail {team}, robot @{bot}. Socket Mode : {socket}. Canal par défaut : {channel}. Membres liés : {members}.',
    de: 'Workspace {team}, Bot @{bot}. Socket Mode: {socket}. Standardkanal: {channel}. Verknüpfte Mitglieder: {members}.',
    es: 'Espacio de trabajo {team}, bot @{bot}. Socket Mode: {socket}. Canal por defecto: {channel}. Miembros vinculados: {members}.',
  },
  socketUp: { en: 'connected', fr: 'connecté', de: 'verbunden', es: 'conectado' },
  socketDown: {
    en: 'not connected',
    fr: 'non connecté',
    de: 'nicht verbunden',
    es: 'no conectado',
  },
  channelNone: { en: 'none', fr: 'aucun', de: 'keiner', es: 'ninguno' },
  channelInvalid: {
    en: 'not a channel ID',
    fr: 'pas un identifiant de canal',
    de: 'keine Kanal-ID',
    es: 'no es un identificador de canal',
  },
  channelNotMember: {
    en: '#{name}, bot not a member: /invite it',
    fr: '#{name}, robot absent : /invite-le',
    de: '#{name}, Bot nicht Mitglied: per /invite einladen',
    es: '#{name}, el bot no es miembro: /invite',
  },
  channelOk: { en: '#{name}', fr: '#{name}', de: '#{name}', es: '#{name}' },
  channelUnknown: {
    en: '{id} (unknown to the bot)',
    fr: '{id} (inconnu du robot)',
    de: '{id} (dem Bot unbekannt)',
    es: '{id} (desconocido para el bot)',
  },
  memberTarget: {
    en: 'direct message to {name}',
    fr: 'message privé à {name}',
    de: 'Direktnachricht an {name}',
    es: 'mensaje directo a {name}',
  },
  errorNotConfigured: {
    en: 'The Slack integration is not configured yet.',
    fr: 'L’intégration Slack n’est pas encore configurée.',
    de: 'Die Slack-Integration ist noch nicht konfiguriert.',
    es: 'La integración de Slack aún no está configurada.',
  },

  // --- replies of the bot in Slack ------------------------------------------------
  replyLinked: {
    en: 'Hello {name}! Your Slack account is now linked to Gladys: write to me here.',
    fr: 'Bonjour {name} ! Votre compte Slack est maintenant lié à Gladys : écrivez-moi ici.',
    de: 'Hallo {name}! Dein Slack-Konto ist jetzt mit Gladys verknüpft: Schreib mir hier.',
    es: '¡Hola, {name}! Su cuenta de Slack ya está vinculada a Gladys: escríbame aquí.',
  },
  replyCodeRefused: {
    en: 'This link code is unknown or expired. In Gladys, open Integrations → Slack → Configuration, click “Generate a link code” and send me the new code within 15 minutes.',
    fr: 'Ce code de liaison est inconnu ou expiré. Dans Gladys, ouvrez Intégrations → Slack → Configuration, cliquez sur « Générer un code de liaison » et envoyez-moi le nouveau code dans les 15 minutes.',
    de: 'Dieser Verknüpfungscode ist unbekannt oder abgelaufen. Öffne in Gladys Integrationen → Slack → Konfiguration, klicke auf „Verknüpfungscode generieren“ und sende mir den neuen Code innerhalb von 15 Minuten.',
    es: 'Este código de vinculación es desconocido o ha caducado. En Gladys, abra Integraciones → Slack → Configuración, pulse «Generar un código de vinculación» y envíeme el nuevo código en un plazo de 15 minutos.',
  },
  replyInvite: {
    en: 'Hello! I am the Gladys Assistant of this home. To talk with me, link your Slack account: in Gladys, open Integrations → Slack → Configuration, click “Generate a link code” in “Link my account”, then send me the code here.',
    fr: 'Bonjour ! Je suis l’assistant Gladys de cette maison. Pour discuter avec moi, liez votre compte Slack : dans Gladys, ouvrez Intégrations → Slack → Configuration, cliquez sur « Générer un code de liaison » dans « Lier mon compte », puis envoyez-moi le code ici.',
    de: 'Hallo! Ich bin der Gladys-Assistent dieses Zuhauses. Um mit mir zu schreiben, verknüpfe dein Slack-Konto: Öffne in Gladys Integrationen → Slack → Konfiguration, klicke unter „Mein Konto verknüpfen“ auf „Verknüpfungscode generieren“ und sende mir dann den Code hier.',
    es: '¡Hola! Soy el asistente Gladys de esta casa. Para hablar conmigo, vincule su cuenta de Slack: en Gladys, abra Integraciones → Slack → Configuración, pulse «Generar un código de vinculación» en «Vincular mi cuenta» y envíeme el código aquí.',
  },
  replyUnavailable: {
    en: 'Gladys cannot read your message right now, please try again in a moment.',
    fr: 'Gladys ne peut pas lire votre message pour le moment, réessayez dans un instant.',
    de: 'Gladys kann deine Nachricht gerade nicht lesen, versuche es gleich noch einmal.',
    es: 'Gladys no puede leer su mensaje en este momento, inténtelo de nuevo en un instante.',
  },
  replyForwardOff: {
    en: 'Conversations with Gladys are turned off on Slack: your message only reaches the scenes.',
    fr: 'Les conversations avec Gladys sont désactivées sur Slack : votre message n’atteint que les scènes.',
    de: 'Unterhaltungen mit Gladys sind auf Slack ausgeschaltet: Deine Nachricht erreicht nur die Szenen.',
    es: 'Las conversaciones con Gladys están desactivadas en Slack: su mensaje solo llega a las escenas.',
  },
  slashHelp: {
    en: 'Write `/gladys` followed by your request, e.g. `/gladys turn on the kitchen light`. Gladys answers you in a direct message.',
    fr: 'Écrivez `/gladys` suivi de votre demande, par exemple `/gladys allume la lumière de la cuisine`. Gladys vous répond en message privé.',
    de: 'Schreib `/gladys` gefolgt von deiner Bitte, z. B. `/gladys mach das Licht in der Küche an`. Gladys antwortet dir per Direktnachricht.',
    es: 'Escriba `/gladys` seguido de su petición, p. ej. `/gladys enciende la luz de la cocina`. Gladys le responde por mensaje directo.',
  },
  slashSent: {
    en: 'Sent to Gladys: the answer comes in a direct message.',
    fr: 'Envoyé à Gladys : la réponse arrive en message privé.',
    de: 'An Gladys gesendet: Die Antwort kommt per Direktnachricht.',
    es: 'Enviado a Gladys: la respuesta llega por mensaje directo.',
  },
  slashScenes: {
    en: 'Received: your scenes take it from here.',
    fr: 'Reçu : vos scènes prennent le relais.',
    de: 'Empfangen: Deine Szenen übernehmen.',
    es: 'Recibido: sus escenas se encargan del resto.',
  },
  testMessage: {
    en: 'Test message from Gladys: the Slack integration works.',
    fr: 'Message de test de Gladys : l’intégration Slack fonctionne.',
    de: 'Testnachricht von Gladys: Die Slack-Integration funktioniert.',
    es: 'Mensaje de prueba de Gladys: la integración de Slack funciona.',
  },

  // --- widget ----------------------------------------------------------------------
  widgetConnection: { en: 'Connection', fr: 'Connexion', de: 'Verbindung', es: 'Conexión' },
  widgetConnected: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
  widgetReconnecting: {
    en: 'Reconnecting',
    fr: 'Reconnexion',
    de: 'Neuverbindung',
    es: 'Reconectando',
  },
  widgetRefused: {
    en: 'Token refused',
    fr: 'Jeton refusé',
    de: 'Token abgelehnt',
    es: 'Token rechazado',
  },
  widgetSocketOff: {
    en: 'Socket Mode off',
    fr: 'Socket Mode désactivé',
    de: 'Socket Mode aus',
    es: 'Socket Mode desactivado',
  },
  widgetNotConfigured: {
    en: 'Not configured',
    fr: 'Non configurée',
    de: 'Nicht konfiguriert',
    es: 'No configurada',
  },
  widgetWorkspace: {
    en: 'Workspace',
    fr: 'Espace de travail',
    de: 'Workspace',
    es: 'Espacio de trabajo',
  },
  widgetBot: { en: 'Bot', fr: 'Robot', de: 'Bot', es: 'Bot' },
  widgetDefaultChannel: {
    en: 'Default channel',
    fr: 'Canal par défaut',
    de: 'Standardkanal',
    es: 'Canal por defecto',
  },
  widgetReceived: { en: 'Received', fr: 'Reçus', de: 'Empfangen', es: 'Recibidos' },
  widgetSent: { en: 'Sent', fr: 'Envoyés', de: 'Gesendet', es: 'Enviados' },
  widgetToday: {
    en: 'Messages of the day',
    fr: 'Messages du jour',
    de: 'Nachrichten von heute',
    es: 'Mensajes de hoy',
  },
  widgetMembers: { en: 'Members', fr: 'Membres liés', de: 'Verknüpft', es: 'Vinculados' },
  widgetNoMessage: {
    en: 'No message from a linked member since the start of the integration.',
    fr: 'Aucun message d’un membre lié depuis le démarrage de l’intégration.',
    de: 'Keine Nachricht eines verknüpften Mitglieds seit dem Start der Integration.',
    es: 'Ningún mensaje de un miembro vinculado desde el inicio de la integración.',
  },
  widgetKindDm: { en: 'DM', fr: 'Privé', de: 'DM', es: 'Directo' },
  widgetKindMention: { en: 'Mention', fr: 'Mention', de: 'Erwähnung', es: 'Mención' },
  widgetKindChannel: { en: 'Channel', fr: 'Canal', de: 'Kanal', es: 'Canal' },
  widgetKindCommand: { en: '/gladys', fr: '/gladys', de: '/gladys', es: '/gladys' },
  widgetHiddenDm: {
    en: 'Direct message to the bot',
    fr: 'Message privé au robot',
    de: 'Direktnachricht an den Bot',
    es: 'Mensaje directo al bot',
  },
  widgetHiddenIn: {
    en: 'Message in {channel}',
    fr: 'Message dans {channel}',
    de: 'Nachricht in {channel}',
    es: 'Mensaje en {channel}',
  },
  widgetTest: { en: 'Send a test', fr: 'Envoyer un test', de: 'Test senden', es: 'Enviar prueba' },

  // --- toasts (200 characters) ------------------------------------------------------
  toastTestSent: {
    en: 'Test message sent to {target}.',
    fr: 'Message de test envoyé : {target}.',
    de: 'Testnachricht gesendet: {target}.',
    es: 'Mensaje de prueba enviado: {target}.',
  },
  toastTestNoTarget: {
    en: 'No target: set a default channel in the configuration, or link a Slack account.',
    fr: 'Aucune cible : indiquez un canal par défaut dans la configuration, ou liez un compte Slack.',
    de: 'Kein Ziel: Lege in der Konfiguration einen Standardkanal fest oder verknüpfe ein Slack-Konto.',
    es: 'Sin destino: indique un canal por defecto en la configuración o vincule una cuenta de Slack.',
  },
  toastTestFailed: {
    en: 'Test message not sent: {error}.',
    fr: 'Message de test non envoyé : {error}.',
    de: 'Testnachricht nicht gesendet: {error}.',
    es: 'Mensaje de prueba no enviado: {error}.',
  },
  linkedMembers: {
    en: '{count} linked member(s)',
    fr: '{count} membre(s) lié(s)',
    de: '{count} verknüpfte(s) Mitglied(er)',
    es: '{count} miembro(s) vinculado(s)',
  },
};

/**
 * @description A text in a language, with its {placeholders} filled.
 * @param {string} key - The text key.
 * @param {string} language - en, fr, de or es (English otherwise).
 * @param {object} [values] - The placeholder values.
 * @returns {string} The text, or the key when unknown.
 * @example
 * t('statusConnected', 'fr', { team: 'Maison', bot: 'gladys' });
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const template = entry[language] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    values[name] === undefined || values[name] === null ? whole : String(values[name]),
  );
}

/**
 * @description A text in the four languages.
 * @param {string} key - The text key.
 * @param {object|Function} [values] - Placeholder values, or `(language) => values`.
 * @returns {Record<string, string>} The multi-language text.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      t(key, language, typeof values === 'function' ? values(language) : values),
    ]),
  );
}

export { LANGUAGES, TEXTS, t, all };
