# Amigo invisible con WhatsApp

Web app para organizar un amigo invisible:

- **Grupos**: el organizador crea el grupo (nombre, presupuesto, moneda, fecha) y comparte un enlace de invitación.
- **Registro**: cada persona se apunta con su nombre y WhatsApp. No hay contraseñas: cada uno recibe por WhatsApp su enlace personal secreto.
- **Listas de deseos**: cada uno edita la suya (texto + enlace opcional) y ve las de los demás.
- **Sorteo**: un solo ciclo (nadie se regala a sí mismo ni hay intercambios cerrados), con exclusiones opcionales (parejas). El organizador nunca ve quién le regala a quién.
- **Mensajes anónimos por WhatsApp**: cada persona escribe a quien le tocó; el mensaje sale **desde el número de la app**, así que no se sabe quién lo envía. El destinatario puede responder desde su enlace, y la respuesta llega al WhatsApp de su amigo invisible.

## Arrancar en local

```bash
npm install
cp .env.example .env      # deja WA_PROVIDER=console para probar
node --env-file=.env server.js
```

Abre http://localhost:3000. En modo `console` los WhatsApp se imprimen en el log del servidor.

## Desplegar

Con Docker (cualquier VPS, Railway, Fly.io, Render…):

```bash
docker build -t amigo-invisible .
docker run -d -p 3000:3000 -v amigo-data:/data --env-file .env amigo-invisible
```

Pon `BASE_URL` con tu dominio público (HTTPS): es el que va en los enlaces que se envían por WhatsApp. La base de datos es un archivo SQLite en `/data`; monta un volumen para no perderla.

## Configurar WhatsApp

WhatsApp no deja que una empresa escriba primero con texto libre: hay que usar una **plantilla aprobada**. La app usa una con dos variables: `{{1}}` = título y `{{2}}` = texto.

### Opción A: Meta WhatsApp Cloud API

1. En developers.facebook.com crea una app de tipo *Business* y añade el producto **WhatsApp**. Registra un número que no esté en uso en WhatsApp normal.
2. En WhatsApp Manager crea la plantilla `amigo_invisible_aviso`, idioma Español (`es`), categoría *Utility*, cuerpo:
   ```
   🎁 {{1}}: {{2}}
   ```
3. Genera un token permanente (usuario del sistema con permiso `whatsapp_business_messaging`).
4. En `.env`: `WA_PROVIDER=meta`, `META_TOKEN`, `META_PHONE_NUMBER_ID`.

### Opción B: Twilio

1. Para probar, usa el *WhatsApp Sandbox* (cada participante debe enviar antes el código `join …` al número del sandbox). Ahí se permite texto libre.
2. En producción, registra un remitente de WhatsApp en Twilio y crea una plantilla en *Content Template Builder* con el cuerpo `🎁 {{1}}: {{2}}`. Pon su `HX…` en `TWILIO_CONTENT_SID`.
3. En `.env`: `WA_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.

Meta y Twilio cobran por cada conversación iniciada por la empresa; consulta sus tarifas vigentes para España y Colombia. `MSG_PER_DAY` limita cuántos mensajes puede mandar cada persona al día.

## Privacidad

- Los números solo los ve el servidor; el organizador los ve enmascarados.
- La asignación del sorteo nunca se muestra en el panel del organizador ni en la API de los demás.
- Quien tenga acceso al servidor o a la base de datos sí podría verla: no lo despliegues en un sitio compartido con los participantes.
- Los enlaces personales funcionan como contraseña: no deben reenviarse.

## API

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/groups` | Crear grupo (+ organizador) |
| GET/POST | `/api/invite/:code` · `/join` | Ver invitación / unirse |
| GET | `/api/me/:token` | Datos del participante, a quién le tocó y los dos hilos |
| PUT | `/api/me/:token/wishlist` | Guardar lista de deseos |
| POST | `/api/me/:token/messages` | `{to:"giftee"|"santa", body}` → WhatsApp |
| GET/PUT | `/api/admin/:adminToken` | Panel y ajustes |
| POST | `/api/admin/:adminToken/draw` · `/reset` · `/resend` · `/exclusions` | Sorteo y gestión |
