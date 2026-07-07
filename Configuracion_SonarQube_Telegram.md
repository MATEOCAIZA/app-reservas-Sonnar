# Configuración de SonarQube con Notificaciones de Telegram en GitHub Actions

Esta guía detalla los pasos completos para configurar el análisis de SonarQube en GitHub Actions, evaluar el Quality Gate y enviar los resultados de forma automática a través de un bot de Telegram.

---

## 1. Configuración de Telegram

Para que el script pueda enviar mensajes a Telegram, necesitas crear un bot y obtener su Token, además de conseguir el ID del chat o grupo donde quieres recibir las notificaciones.

### A. Obtener el Token del Bot (BotFather)
1. Abre Telegram y busca al usuario **@BotFather**.
2. Inicia un chat con él y envía el comando `/newbot`.
3. Sigue las instrucciones:
   - Asígnale un **nombre** a tu bot (ej. `SonarQube Alert`).
   - Asígnale un **username** que debe terminar en "bot" (ej. `SonnarAppReservasBot`).
4. Al finalizar, BotFather te entregará un **Token HTTP API** (ej. `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`).
   - **Copia y guarda este token**, ya que lo necesitarás en GitHub.

### B. Obtener el Chat ID
El `CHAT_ID` es el identificador único del usuario o grupo al que el bot enviará los mensajes.

1. Abre un chat directo con tu nuevo bot (o añádelo a un grupo) y envíale un mensaje cualquiera (ej. "Hola").
2. Abre tu navegador web e ingresa a la siguiente URL, reemplazando `<TU_TOKEN>` con el token que te dio BotFather:
   ```
   https://api.telegram.org/bot<TU_TOKEN>/getUpdates
   ```
3. Verás una respuesta en formato JSON. Busca el bloque `message` -> `chat` -> `id`.
4. Ese número es tu **Chat ID** (puede ser positivo si es un usuario directo, o negativo si es un grupo, por ejemplo `-100123456789`). Cópialo.

---

## 2. Configuración de SonarQube Local y Cloudflare

Dado que estás utilizando una instancia local de SonarQube que se expone a internet, necesitas configurarlo de la siguiente forma:

### A. Obtener el Token de SonarQube
1. Ingresa a tu servidor local de SonarQube (`http://localhost:9000`).
2. Ve a **My Account** (esquina superior derecha) -> **Security**.
3. En la sección "Generate Tokens", escribe un nombre (ej. `github-actions`) y genera un token del tipo **User Token** o **Project Analysis Token**.
4. **Copia este token**.

### B. Exponer SonarQube mediante Cloudflare Tunnel
Dado que GitHub Actions corre en la nube, necesita una URL pública para acceder a tu servidor local.
1. Abre tu terminal y ejecuta el túnel de Cloudflare hacia el puerto de SonarQube:
   ```bash
   cloudflared tunnel --url http://localhost:9000
   ```
2. Cloudflare te generará una URL pública dinámica (ej. `https://tu-url-random.trycloudflare.com`). **Cópiala**, asegúrate de que no tenga barra (`/`) al final.

---

## 3. Configuración en GitHub Secrets

Para mantener todo de forma segura, guardaremos los tokens y variables en los secretos de GitHub.

1. Ve a tu repositorio en GitHub.
2. Navega a **Settings -> Secrets and variables -> Actions**.
3. Crea los siguientes secretos en **New repository secret**:
   - `TELEGRAM_TOKEN`: El token de tu bot de BotFather.
   - `TELEGRAM_CHAT_ID`: El ID del chat o grupo.
   - `SONAR_TOKEN`: El token generado en la interfaz de SonarQube.
   - `SONAR_HOST_URL`: La URL pública de tu túnel de Cloudflare.

---

## 4. Configuración del Proyecto (`sonar-project.properties`)

En la raíz de tu proyecto, asegúrate de tener el archivo `sonar-project.properties` configurado. 
**Importante:** No debes incluir la propiedad `sonar.qualitygate.wait=true` para no trabar el proceso de notificación.

Ejemplo de archivo:
```properties
sonar.projectKey=app-reservas-monorepo
sonar.projectName=App Reservas Monorepo
sonar.projectVersion=1.0.0
sonar.sources=auth-service,booking-service,user-service,notification-service,frontend
sonar.exclusions=**/node_modules/**,**/dist/**,**/.next/**,**/coverage/**,**/*.spec.js,**/*.test.js
sonar.tests=auth-service,booking-service,user-service,notification-service,frontend
sonar.test.inclusions=**/*.test.js,**/*.spec.js,**/*.test.ts,**/*.spec.ts,**/*.test.tsx,**/*.spec.tsx
sonar.javascript.lcov.reportPaths=coverage/lcov.info
sonar.sourceEncoding=UTF-8
```

---

## 5. Configuración de GitHub Actions (`.github/workflows/sonarqube.yml`)

El pipeline se encarga de realizar el escaneo de código, revisar el Quality Gate de SonarQube y ejecutar el script de notificación en Node.js, basándose en el reporte que se genera en la carpeta `.scannerwork`.

```yaml
name: SonarQube & Telegram Notifications

on:
  push:
    branches:
      - main
      - develop
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  analysis:
    name: SonarQube Scan & Notify
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      # Paso 1: Ejecutar escáner de SonarQube
      - name: SonarQube Scan
        uses: sonarsource/sonarqube-scan-action@v2.0.2
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}

      # Paso 2: Verificar estado del Quality Gate (sigue corriendo aunque falle gracias al continue-on-error)
      - name: SonarQube Quality Gate Check
        id: quality_gate
        continue-on-error: true
        uses: sonarsource/sonarqube-quality-gate-action@v1.1.0
        with:
          scanMetadataReportFile: .scannerwork/report-task.txt
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}

      # Paso 3: Configurar Node para ejecutar el notificador
      - name: Setup Node.js
        if: always()
        uses: actions/setup-node@v4
        with:
          node-version: 18

      # Paso 4: Ejecutar script de Telegram que lee los resultados
      - name: Send Telegram Notification
        if: always()
        env:
          TELEGRAM_TOKEN: ${{ secrets.TELEGRAM_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}
          COMMIT_SHA: ${{ github.sha }}
          BRANCH: ${{ github.ref_name }}
          AUTHOR: ${{ github.event.head_commit.author.name }}
          COMMIT_MESSAGE: ${{ github.event.head_commit.message }}
          REPOSITORY: ${{ github.repository }}
          QUALITY_GATE_STATUS: ${{ steps.quality_gate.outcome }}
        run: node tools/telegram-notifier.js

      # Paso 5: Fallar el pipeline de GitHub si el Quality Gate no fue aprobado
      - name: Fail pipeline if Quality Gate failed
        if: steps.quality_gate.outcome == 'failure'
        run: |
          echo "❌ Quality Gate falló. El pipeline se marca como fallido."
          exit 1
```

## 6. Detalles Importantes del Script (`telegram-notifier.js`)

El script que envíe los mensajes debe buscar el archivo de resultados en la ruta correcta para saber el `projectKey` que requiere la API:

```javascript
// ... dentro de tools/telegram-notifier.js
try {
  // Asegúrate de que apunte a .scannerwork
  const report = require('fs').readFileSync('.scannerwork/report-task.txt', 'utf8');
  const match  = report.match(/^projectKey=(.+)$/m);
  if (match) projectKey = match[1].trim();
} catch {
  // Manejo de errores
}
// ...
```

Con estos pasos configurados, cada vez que envíes código (Push o PR), SonarQube analizará el proyecto y recibirás en Telegram un resumen en tiempo real indicando si el código es aceptado o qué métricas lo hicieron fallar.
