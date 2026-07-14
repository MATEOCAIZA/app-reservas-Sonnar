# Plan de Implementación: DAST (OWASP ZAP) + Notificaciones Telegram

## 1. Objetivo

Incorporar un análisis dinámico de seguridad (DAST) al pipeline de CI/CD existente, complementando el análisis estático (SAST) que ya provee SonarQube. El resultado del escaneo debe notificarse al mismo grupo de Telegram que hoy recibe las alertas de SonarQube, siguiendo el patrón ya establecido en el repositorio.

**Estado actual del repo (punto de partida):**
- [.github/workflows/sonarqube.yml](.github/workflows/sonarqube.yml): SAST con SonarQube + notificación Telegram.
- [tools/telegram-notifier.js](tools/telegram-notifier.js): script Node que arma y envía el mensaje a Telegram.
- [docker-compose.yml](docker-compose.yml): orquesta `mongo`, `auth-service`, `booking-service`, `user-service`, `notification-service`, `frontend` y `sonarqube`.

**Fuera de alcance del taller original** ([Tarea.md](Tarea.md) solo exige SAST + Telegram), por lo que este plan se documenta como mejora adicional.

---

## 2. Herramienta seleccionada

**OWASP ZAP** (Zed Attack Proxy), vía la acción oficial de GitHub:

- `zaproxy/action-baseline` → escaneo rápido, pasivo (no intrusivo), ideal para correr en cada push/PR.
- `zaproxy/action-full-scan` → escaneo activo más profundo (incluye ataques), más lento, recomendado solo en `main`/cron nocturno.

**Justificación:** gratuita, mantenida por OWASP, sin infraestructura adicional, y con salida en JSON/HTML fácil de parsear para el notificador de Telegram (mismo patrón que `report-task.txt` de SonarQube).

---

## 3. Arquitectura del nuevo pipeline

```
Trigger (push a main/develop o cron)
   │
   ├─ 1. Checkout del código
   ├─ 2. docker-compose up -d --build   (levanta toda la app)
   ├─ 3. Esperar healthcheck (curl loop sobre el frontend/API)
   ├─ 4. Ejecutar OWASP ZAP Baseline Scan → http://localhost:3000
   ├─ 5. Subir reporte (HTML/JSON) como artifact
   ├─ 6. Parsear resultados (alertas High/Medium/Low)
   ├─ 7. Enviar notificación a Telegram (reusa/extiende telegram-notifier.js)
   └─ 8. docker-compose down (limpieza, always())
```

---

## 4. Pasos de implementación

### Paso 1 — Preparar el entorno objetivo del escaneo
- Confirmar variables de entorno mínimas para levantar la app en el runner (mismas que usa `docker-compose.yml`: `MONGO_URI`, `JWT_SECRET`, credenciales de `notification-service`).
- Si algún servicio requiere secretos sensibles (ej. `EMAIL_PASS`), decidir si se usan valores dummy en CI (recomendado, ya que el DAST no necesita enviar correos reales).

### Paso 2 — Crear archivo de reglas de ZAP (opcional pero recomendado)
- Archivo `.zap/rules.tsv` en la raíz del repo.
- Permite marcar como `IGNORE` alertas esperables en un entorno de desarrollo/local (ej. falta de HSTS, cookies sin `Secure` por no usar HTTPS local).

### Paso 3 — Crear el workflow `.github/workflows/dast.yml`
Job propuesto:

```yaml
name: DAST - OWASP ZAP & Telegram Notifications

on:
  push:
    branches: [main, develop]
  schedule:
    - cron: '0 3 * * *'   # opcional: escaneo nocturno

jobs:
  dast:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Levantar aplicación con Docker Compose
        run: docker compose up -d --build

      - name: Esperar a que el frontend responda
        run: |
          for i in $(seq 1 30); do
            curl -sf http://localhost:3000 && break
            echo "Esperando frontend... ($i)"
            sleep 5
          done

      - name: OWASP ZAP Baseline Scan
        id: zap_scan
        uses: zaproxy/action-baseline@v0.12.0
        with:
          target: 'http://localhost:3000'
          rules_file_name: '.zap/rules.tsv'
          cmd_options: '-J zap-report.json'
          fail_action: false   # no rompe el pipeline; se decide después según severidad

      - name: Setup Node.js
        if: always()
        uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Enviar notificación a Telegram
        if: always()
        env:
          TELEGRAM_TOKEN: ${{ secrets.TELEGRAM_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
          COMMIT_SHA: ${{ github.sha }}
          BRANCH: ${{ github.ref_name }}
          REPOSITORY: ${{ github.repository }}
        run: node tools/telegram-notifier-dast.js

      - name: Subir reporte ZAP como artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: zap-report
          path: |
            report_html.html
            zap-report.json

      - name: Apagar contenedores
        if: always()
        run: docker compose down
```

> Nota: `fail_action` se deja en `false` inicialmente para no bloquear el pipeline mientras se ajustan las reglas y se reduce el ruido de falsos positivos. Una vez estabilizado, se puede activar para bloquear ante alertas `High`.

### Paso 4 — Extender el notificador de Telegram
Crear `tools/telegram-notifier-dast.js` (basado en la estructura de `tools/telegram-notifier.js`):
- Leer `zap-report.json` generado por la acción.
- Contar alertas por severidad (`High`, `Medium`, `Low`, `Informational`).
- Armar mensaje Markdown con: autor, rama, commit, resumen de alertas y link al artifact/reporte.
- Reusar la misma lógica de envío HTTPS a la API de Telegram (`sendMessage`) ya existente, para no duplicar credenciales ni formato.

### Paso 5 — Configurar secretos en GitHub
Ya existen `TELEGRAM_TOKEN`/`TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` (reutilizables). No se requieren secretos nuevos salvo que se desee escanear una URL pública distinta a `localhost`.

### Paso 6 — Validar localmente antes de subir a CI
- Levantar la app con `docker-compose up -d`.
- Ejecutar ZAP localmente (Docker: `docker run -t zaproxy/zap-stable zap-baseline.py -t http://localhost:3000`) para validar reglas y reducir falsos positivos antes de automatizar.

### Paso 7 — Documentar en README
Agregar sección "DAST con OWASP ZAP" en [README.md](README.md), siguiendo el mismo formato que la sección de SonarQube: cómo se ejecuta, qué umbral/reglas aplican y cómo interpretar la notificación de Telegram.

### Paso 8 — Evidencia funcional
- Captura del reporte HTML de ZAP mostrando alertas detectadas.
- Captura del grupo de Telegram mostrando la notificación del escaneo DAST.

---

## 5. Checklist de implementación

- [ ] Crear `.zap/rules.tsv`
- [ ] Crear `.github/workflows/dast.yml`
- [ ] Crear `tools/telegram-notifier-dast.js`
- [ ] Probar localmente con `docker-compose up` + ZAP en Docker
- [ ] Ejecutar workflow en una rama de prueba y validar notificación en Telegram
- [ ] Ajustar `rules.tsv` para eliminar falsos positivos
- [ ] Documentar en `README.md`
- [ ] (Opcional) Activar `fail_action: true` una vez estabilizado, para bloquear el pipeline ante alertas `High`

---

## 6. Riesgos / consideraciones

- **Tiempo de ejecución:** levantar todos los microservicios + Mongo en el runner puede tardar varios minutos; considerar `full-scan` solo en cron nocturno, no en cada push.
- **Falsos positivos en localhost:** ausencia de HTTPS/HSTS en el entorno de CI generará alertas que no aplican en producción; deben filtrarse vía `rules.tsv`.
- **Secretos dummy:** verificar que `notification-service` no intente enviar correos reales durante el escaneo (usar credenciales de prueba ya presentes en `docker-compose.yml`).
- **No bloquear el pipeline de entrada:** igual que con SonarQube (`continue-on-error`), se recomienda no fallar el build hasta tener el ruido de ZAP controlado.
