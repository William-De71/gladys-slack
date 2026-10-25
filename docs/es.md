# Slack

## Presentación

Hable con Gladys en **Slack**, por mensaje directo con un bot de su propio espacio de trabajo: Gladys responde allí, y también envía allí sus notificaciones e imágenes de cámara. Sus escenas pueden reaccionar cuando un miembro vinculado escribe al bot, menciona a `@gladys` en un canal o escribe `/gladys`, y publicar ellas mismas mensajes de Slack.

La integración usa **Socket Mode**: abre ella misma la conexión con Slack, así que Gladys no necesita URL pública, ni puerto abierto, ni Gladys Plus. Los mensajes pasan por los servidores de Slack (transporte en la nube). Integración no oficial, sin relación con Slack Technologies; aún no probada en un espacio de trabajo real.

## Requisitos

- Gladys Assistant 5.3.0 o posterior.
- Un espacio de trabajo de Slack donde pueda instalar una app (en algunos espacios un administrador debe aprobarla).
- Acceso a Internet desde Gladys (solo saliente).

### Crear la app de Slack

1. En **Integraciones → Slack → Configuración**, abra el enlace **Crear la app Gladys en Slack**: Slack abre su página de creación de apps con el manifiesto de abajo ya rellenado. Elija su espacio de trabajo, revise y pulse **Create**.
2. En la app, **Basic Information → App-Level Tokens → Generate Token and Scopes**: dele un nombre, añada el permiso `connections:write`, genérelo y copie el token que empieza por `xapp-`.
3. **Install App → Install to Workspace**, autorice y copie el **Bot User OAuth Token**, que empieza por `xoxb-`.

Sin el enlace: abra [api.slack.com/apps](https://api.slack.com/apps), **Create New App → From a manifest**, elija el espacio de trabajo y pegue este manifiesto (también en [slack-app-manifest.json](https://github.com/William-De71/gladys-slack/blob/main/slack-app-manifest.json)):

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

La app sigue siendo una app interna de su espacio de trabajo. Pide el conjunto mínimo de permisos que usa la integración: sin token de usuario, sin acceso a las direcciones de correo y sin lectura del historial (los mensajes llegan como eventos).

## Configuración

| Campo                                 | Significado                                                                                                                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token del bot                         | `xoxb-…`, OAuth & Permissions → Bot User OAuth Token. Se guarda cifrado.                                                                                                                                  |
| Token de aplicación                   | `xapp-…` con el permiso `connections:write`, Basic Information → App-Level Tokens. Se guarda cifrado.                                                                                                     |
| Enviar los mensajes directos a Gladys | Activado por defecto. Desactivado: los mensajes de los miembros vinculados solo llegan a las escenas.                                                                                                     |
| Canal por defecto                     | Opcional. Un identificador de canal (`C…`, al final de los detalles del canal) o de miembro (`U…`), para la acción de escena y el botón de prueba. Invite primero al bot a ese canal (`/invite @gladys`). |
| Idioma del bot                        | Los pocos textos que el bot escribe por sí mismo a los miembros que Gladys aún no conoce (invitación, código rechazado).                                                                                  |

Guarde y pulse **Probar la conexión**: muestra el espacio de trabajo, el bot, el estado de Socket Mode, el canal por defecto (y si el bot está en él) y el número de miembros vinculados.

### Vincular su cuenta de Slack

Cada usuario lo hace una vez: en **Integraciones → Slack → Configuración**, bloque **Vincular mi cuenta**, pulse **Generar un código de vinculación** y luego, en Slack, envíe el código a `@gladys` por mensaje directo (Aplicaciones → Gladys → Mensajes), o escriba `/gladys` seguido del código en cualquier sitio. El bot responde que la cuenta está vinculada. El código es válido 15 minutos, una sola vez.

Un miembro no vinculado solo recibe una invitación a vincularse (una vez al día): nunca llega a Gladys ni a las escenas. Vincule solo a personas de confianza: un miembro vinculado habla con la autoridad de su usuario de Gladys.

## Uso

### Hablar con Gladys

Escriba a `@gladys` por mensaje directo, como en el chat de Gladys: «enciende la luz de la cocina», «¿qué temperatura hace en el salón?». Gladys responde en la misma conversación. `/gladys <petición>` funciona desde cualquier canal; la respuesta llega al mensaje directo y solo usted ve la confirmación. Gladys también envía allí las notificaciones de sus escenas («Enviar un mensaje» a un usuario) y las imágenes de cámara («Enviar una imagen de cámara»).

Se ignoran los mensajes de otros bots, las ediciones, los mensajes reenviados por Slack y los mensajes de hace más de 5 minutos (tras un corte).

### Widget de panel

![El widget de Slack: mensajes del día, miembros vinculados, últimos mensajes, conexión y botón de prueba (ilustración generada, no una captura de pantalla)](https://raw.githubusercontent.com/William-De71/gladys-slack/main/docs/assets/widgets.es.png)

Ilustración generada, no una captura de pantalla. El widget **Slack** muestra los mensajes recibidos y enviados hoy, los miembros vinculados, los últimos mensajes de los miembros vinculados, la conexión, el espacio de trabajo, el bot y el canal por defecto, con un botón **Enviar prueba**. El texto de los mensajes solo aparece si el ajuste del widget **Mostrar el texto de los mensajes** está activado (desactivado por defecto: un panel puede compartirse).

### Escenas

Disparadores, solo para miembros vinculados:

- **Mensaje de Slack recibido**: un mensaje directo al bot, o un mensaje en un canal al que se invitó al bot. Filtros: dónde, canal, miembro, usuario de Gladys, texto exacto.
- **Gladys mencionada en Slack**: `@gladys` en un canal; el texto sin la mención. Los mismos filtros.
- **Comando /gladys escrito**: filtros canal, miembro, usuario de Gladys, texto exacto.
- **Mensaje de Slack no enviado**: se rechazó un mensaje de Gladys; una vez por miembro, hasta que un mensaje vuelva a pasar.

Cada disparador da sus detalles como variables, p. ej. `{{triggerEvent.data.text}}`, `{{triggerEvent.data.first_name}}`, `{{triggerEvent.data.ts}}`.

Acción **Enviar un mensaje de Slack**: un identificador de canal o de miembro (vacío: el canal por defecto), el texto con formato de Slack (`*negrita*`, `<@U0123456789>`, `<https://example.com|un enlace>`) y un hilo opcional. Salidas: `ts`, `channel_id`, `link`.

Ejemplos:

- `@gladys apaga todo` en `#casa` → apagar las luces y luego enviar «Hecho ✅» en el hilo `{{triggerEvent.data.ts}}`.
- `/gladys buenas noches` → ejecutar la escena de noche.
- La puerta de entrada se abre sin nadie en casa → enviar un mensaje a `#casa` y una imagen de cámara a los usuarios vinculados.

## Solución de problemas

- **«Introduzca el token del bot…» / «debe empezar por xoxb-»**: el token del bot es el Bot User OAuth Token (`xoxb-`), no un token de usuario (`xoxp-`); el token de aplicación empieza por `xapp-`, no por `xoxe.xapp-` (deje desactivada la rotación de tokens).
- **«Slack rechaza el token del bot»**: cópielo de nuevo en OAuth & Permissions; reinstale la app tras cambiar sus permisos.
- **«Slack rechaza el token de aplicación»**: necesita el permiso `connections:write`.
- **«El Socket Mode está desactivado»**: Settings → Socket Mode en la app de Slack.
- **El bot no responde a un mensaje directo**: ¿está vinculada la cuenta? ¿Está activado «Enviar los mensajes directos a Gladys»? En la app, App Home → «Allow users to send Slash commands and messages from the messages tab» debe estar marcado (lo está en el manifiesto).
- **Ningún disparador desde un canal**: invite al bot con `/invite @gladys`; solo los miembros vinculados activan escenas.
- **«not_in_channel»** en la acción de escena: invite al bot al canal. Un nombre de canal no funciona: use su identificador.
- Informe de un problema en [GitHub](https://github.com/William-De71/gladys-slack/issues) con las versiones de Gladys y de la integración, el mensaje de **Probar la conexión** y los registros (`DEBUG=gladys-integration-sdk`). No pegue nunca un token.
