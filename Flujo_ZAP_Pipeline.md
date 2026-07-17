# Flujo de OWASP ZAP en el Pipeline CI/CD

## ¿Qué es OWASP ZAP aquí?

OWASP ZAP (Zed Attack Proxy) se usa como herramienta **DAST** (Dynamic Application Security Testing) dentro del pipeline de GitHub Actions. Su objetivo es analizar la aplicación **en ejecución** buscando vulnerabilidades visibles desde afuera (cabeceras inseguras, endpoints expuestos, etc.), complementando el SAST que ya hace SonarQube.

---

## Archivos involucrados

| Archivo | Rol |
|---|---|
| `.github/workflows/dast.yml` | Workflow que orquesta todo el pipeline DAST |
| `.zap/rules.tsv` | Reglas de filtrado de alertas ZAP (IGNORE / WARN / FAIL) |
| `tools/telegram-notifier-dast.js` | Script Node.js que parsea el reporte y notifica a Telegram |
| `docker-compose.yml` | Levanta los microservicios que ZAP va a escanear |
| `report_json.json` / `report_html.html` / `report_md.md` | Reportes generados automáticamente por la acción ZAP |

---

## Triggers del pipeline

El workflow `dast.yml` se dispara en tres situaciones:

```
push → main o develop
workflow_dispatch (ejecución manual desde GitHub)
schedule: cron '0 3 * * *'  →  todos los días a las 03:00 UTC
```

---

## Flujo paso a paso

```
Trigger
   │
   ▼
1. actions/checkout@v4
   └─ Clona el repositorio en el runner ubuntu-latest
   │
   ▼
2. Generar frontend/.env.production.local
   └─ Se crea en el runner (el archivo está en .gitignore)
       NEXT_PUBLIC_API_URL=/api/auth
       NEXT_PUBLIC_BOOKING_URL=/api/bookings
       NEXT_PUBLIC_USER_URL=/api/users
   │
   ▼
3. docker compose up -d --build
   └─ Levanta todos los servicios definidos en docker-compose.yml:
       • mongo           → :27017
       • auth-service    → :4000
       • booking-service → :5000
       • notification-service → :5002
       • user-service    → :5003
       • frontend (Next.js) → :3000
       • sonarqube       → :9000  (no lo escanea ZAP, pero arranca)
   │
   ▼
4. Healthcheck del frontend (curl loop)
   └─ Hace hasta 30 intentos con 5 s de espera entre cada uno
       curl -sf http://localhost:3000
       Si ninguno responde → imprime logs y falla el job
   │
   ▼
5. zaproxy/action-baseline@v0.15.0  ← ZAP BASELINE SCAN
   ├─ target: http://localhost:3000
   ├─ rules_file_name: .zap/rules.tsv
   ├─ fail_action: false  (no rompe el pipeline)
   └─ allow_issue_writing: false (no crea GitHub Issues)
       │
       ├─ ZAP hace un spider pasivo de la app
       ├─ Lanza ataques/pruebas pasivas (baseline = no intrusivo)
       └─ Genera:
           • report_html.html
           • report_json.json
           • report_md.md
   │
   ▼
6. actions/setup-node@v4  (Node 18)
   └─ Necesario para ejecutar el notificador de Telegram
   │
   ▼
7. node tools/telegram-notifier-dast.js
   ├─ Lee report_json.json
   ├─ Cuenta alertas por severidad:
   │     🔴 High (riskcode 3)
   │     🟠 Medium (riskcode 2)
   │     🟡 Low (riskcode 1)
   │     ℹ️  Informational (riskcode 0)
   ├─ Lista los top 8 hallazgos High/Medium
   └─ Envía mensaje Markdown a Telegram vía HTTPS
       POST https://api.telegram.org/bot{TOKEN}/sendMessage
   │
   ▼
8. actions/upload-artifact@v4
   └─ Sube como artifact de la run:
       • report_html.html
       • report_json.json
       • report_md.md
   │
   ▼
9. docker compose down -v   (siempre se ejecuta, if: always())
   └─ Limpia todos los contenedores y volúmenes del runner
```

---

## Detalle: reglas de filtrado `.zap/rules.tsv`

ZAP aplica estas reglas **antes** de decidir si una alerta rompe o no el pipeline:

| ID regla | Acción | Motivo |
|---|---|---|
| `10035` | `IGNORE` | Strict-Transport-Security no aplica en localhost sin HTTPS |
| `10063` | `IGNORE` | Permissions Policy Header — mismo motivo |
| `10038` | `WARN` | Content Security Policy Header Not Set |
| `10021` | `WARN` | X-Content-Type-Options Header Missing |

> Reglas no listadas → acción por defecto: **WARN** (no falla el pipeline).

---

## Detalle: notificador Telegram (`telegram-notifier-dast.js`)

El script corre en Node.js puro (sin dependencias externas) y hace:

1. Lee variables de entorno: `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `COMMIT_SHA`, `BRANCH`, `AUTHOR`, `COMMIT_MESSAGE`, `REPOSITORY`, `RUN_URL`.
2. Si alguna variable de Git falta, la obtiene con `execSync('git ...')` como fallback.
3. Parsea `report_json.json` buscando `site[].alerts[]` y agrupa por `riskcode`.
4. Construye el mensaje con formato Markdown de Telegram.
5. Hace `https.request` directamente a la API de Telegram (sin librerías de terceros).

### Secretos de GitHub requeridos

| Secreto | Uso |
|---|---|
| `TELEGRAM_TOKEN` | Token del bot de Telegram |
| `TELEGRAM_CHAT_ID` | ID del grupo/canal de Telegram |

> No se necesitan secretos adicionales más allá de los ya usados por el workflow de SonarQube.

---

## Acción ZAP usada

```yaml
uses: zaproxy/action-baseline@v0.15.0
```

- **Tipo de escaneo:** Baseline (pasivo, no intrusivo).
- **No** crea GitHub Issues (`allow_issue_writing: false`).
- **No** falla el pipeline por alertas (`fail_action: false`) — se puede activar cuando las reglas en `rules.tsv` estén estabilizadas.

---

## Diagrama resumido

```
GitHub Push / Cron
        │
        ▼
┌──────────────────────────────────────┐
│          dast.yml (GitHub Actions)   │
│                                      │
│  1. Checkout                         │
│  2. Crear .env.production.local      │
│  3. docker compose up --build        │
│  4. Healthcheck (curl loop)          │
│  5. ┌─────────────────────────┐      │
│     │  zaproxy/action-baseline│      │
│     │  → Spider http://localhost:3000│
│     │  → .zap/rules.tsv              │
│     │  → report_json.json    │      │
│     └─────────────────────────┘      │
│  6. setup-node@v4                    │
│  7. telegram-notifier-dast.js        │
│     └─ Telegram API → grupo         │
│  8. upload-artifact (reportes)       │
│  9. docker compose down -v           │
└──────────────────────────────────────┘
```
