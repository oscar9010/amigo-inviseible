# Activar los mensajes instantáneos (Firebase, gratis)

1. Entra en https://console.firebase.google.com con tu cuenta de Google y pulsa **Agregar proyecto** (puedes desactivar Analytics).
2. En el proyecto: **Compilación > Firestore Database > Crear base de datos** (modo producción, la región europea más cercana).
3. En la pestaña **Reglas** pega el contenido de `firestore.rules` y pulsa **Publicar**.
3b. Ve a **Authentication > Comenzar > Método de acceso**, activa **Anónimo** y guarda (hace falta para revocar enlaces).
4. En **Configuración del proyecto (engranaje) > Tus apps > `</>` Web**, registra una app. Copia el objeto `firebaseConfig`.
5. En `docs/index.html` sustituye `const FIREBASE_CONFIG = null;` por `const FIREBASE_CONFIG = { apiKey: "...", authDomain: "...", projectId: "...", ... };`
6. Haz el sorteo de nuevo (los enlaces antiguos no llevan chat) y envía los enlaces nuevos.

La `apiKey` de Firebase para web no es secreta; la seguridad la dan las reglas del paso 3.
