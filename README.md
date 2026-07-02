# 📆 ReservasEC

**ReservasEC** es una plataforma fullstack de gestión de reservas desarrollada con una arquitectura de microservicios. Permite a los usuarios registrarse, iniciar sesión, gestionar su perfil, crear y cancelar reservas, y recibir notificaciones. El sistema está dockerizado para facilitar el despliegue local.

## 🚀 Tecnologías principales

- **Frontend:** Next.js + Tailwind CSS
- **Backend (Microservicios):**
  - Auth Service (Node.js + Express)
  - Booking Service (Node.js + Express)
  - User Service (Node.js + Express)
  - Notification Service (Node.js + Express + Nodemailer)
- **Base de datos:** MongoDB
- **Autenticación:** JSON Web Tokens (JWT)
- **Contenedores:** Docker + Docker Compose

---

## 📁 Estructura de carpetas

```plaintext
/reservas-ec
├── frontend/             # Next.js App
├── auth-service/         # Servicio de autenticación
├── user-service/         # Servicio de usuarios
├── booking-service/      # Servicio de reservas
├── notification-service/ # Servicio de notificaciones por email
└── docker-compose.yml    # Orquestación de todos los servicios
```

---

## ⚙️ Configuración del entorno

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/reservas-ec.git
cd reservas-ec
```

### 2. Variables de entorno

🔐 Frontend (frontend/.env.production.local)

```bash
NEXT_PUBLIC_API_URL=/api/auth
NEXT_PUBLIC_BOOKING_URL=/api/bookings
NEXT_PUBLIC_USER_URL=/api/users
```

🔐 Backend .env (cada microservicio)
Ejemplo para auth-service:

```bash
PORT=4000
MONGO_URI=mongodb://mongo:27017/auth-db
JWT_SECRET=supersecretkey
```

Repite para los demás servicios cambiando PORT, MONGO_URI y usando el mismo JWT_SECRET.

### 3. 🐳 Uso con Docker

1. Construir los contenedores

```bash
docker-compose build
```

3. Levantar los servicios

```bash
docker-compose up
```

La app estará disponible en http://localhost:3000

## ✅ Funcionalidades principales

- Registro e inicio de sesión de usuarios

- Perfil editable

- Creación y cancelación de reservas

- Historial de reservas activas y canceladas

- Límite de 5 reservas canceladas visibles

- Notificaciones por email (reserva y cancelación)

- Gestión de microservicios independientes

---

## 🛠️ Configuración de Calidad y Notificaciones (SonarQube & Telegram)

Esta sección detalla cómo configurar y ejecutar el análisis de calidad de código con SonarQube y configurar las notificaciones automáticas en un grupo de Telegram.

### 1. Levantar SonarQube Localmente

SonarQube ha sido integrado en el archivo `docker-compose.yml` para facilitar su ejecución.

1. Inicie los contenedores (incluyendo SonarQube):
   ```bash
   docker-compose up -d
   ```
2. Acceda a la interfaz de usuario de SonarQube en su navegador:
   [http://localhost:9000](http://localhost:9000)
3. Inicie sesión con las credenciales por defecto:
   - **Usuario:** `admin`
   - **Contraseña:** `admin` *(el sistema le pedirá cambiar la contraseña en el primer inicio)*

### 2. Configurar el Quality Gate (`StrictGate`) en SonarQube

Para asegurar la calidad del código, cree un Quality Gate personalizado con los siguientes criterios:

1. En la barra superior de SonarQube, vaya a **Quality Gates** y haga clic en **Create**.
2. Nombre el Quality Gate como `StrictGate`.
3. Agregue las siguientes condiciones haciendo clic en **Add Condition**:

| Métrica | Condición | Umbral |
| :--- | :--- | :--- |
| **Blocker Issues** | is greater than | 0 |
| **Critical Issues** | is greater than | 0 |
| **Major Issues** | is greater than | 5 |
| **Security Hotspots Reviewed** | is less than | 100% |
| **Coverage** | is less than | 80% |
| **Duplicated Lines (%)** | is greater than | 3% |
| **Technical Debt Ratio** | is greater than | 2.5% |
| **Cyclomatic Complexity** | is greater than | 50 |
| **Cognitive Complexity** | is greater than | 30 |

4. Establezca `StrictGate` como el Quality Gate por defecto (**Set as Default**) o asígnelo manualmente a su proyecto.
5. El archivo [qualitygate.json](file:///c:/Users/Acer/Documents/ESPE/7mo%20-%208vo/Sw%20Seguro/III%20Parcial/app-reservas-Sonnar/qualitygate.json) contiene la estructura exportada de este Quality Gate para fines de control de versiones y entregas.

### 3. Ejecución del Análisis Estático de Manera Manual

Si desea ejecutar el análisis localmente en su máquina de desarrollo sin usar GitHub Actions:

1. Instale el escáner de SonarQube de forma global en su máquina:
   ```bash
   npm install -g sonar-scanner
   ```
2. Genere un token de usuario en SonarQube:
   - Vaya a **My Account** (esquina superior derecha) -> **Security** -> **Generate Token**.
   - Guarde el token generado.
3. Ejecute el análisis en la raíz del proyecto ejecutando:
   ```bash
   sonar-scanner -Dsonar.token=TU_TOKEN_DE_SONAR -Dsonar.host.url=http://localhost:9000
   ```

### 4. Configurar el Bot de Telegram y Grupo de Trabajo

#### Paso 4.1: Crear el Bot en Telegram
1. Abra Telegram y busque a **@BotFather**.
2. Envíe el comando `/newbot`.
3. Ingrese un nombre descriptivo para su bot (ej. `ReservasECNotifierBot`).
4. Ingrese un nombre de usuario único que termine en `bot` (ej. `reservas_ec_notifier_bot`).
5. Copie y guarde a buen recaudo el **HTTP API Token** generado (ej. `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`).

#### Paso 4.2: Crear el Grupo y Obtener el Chat ID
1. Cree un nuevo grupo en Telegram e invite a los integrantes del equipo.
2. Busque e invite al bot recién creado como miembro del grupo.
3. Envíe un mensaje de prueba al grupo (ejemplo: `/test`).
4. Obtenga el **Chat ID** del grupo haciendo una consulta HTTP GET en su navegador web a la siguiente URL (reemplace `<TOKEN>` con el token obtenido en el paso anterior):
   ```text
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
5. En la respuesta JSON, busque el objeto `"chat"` y copie el `"id"` (suele ser un número negativo para grupos, ej. `-1002345678901`).

### 5. Integración con GitHub Actions

El repositorio incluye dos pipelines configurados en `.github/workflows/`:
- [sonarqube.yml](file:///c:/Users/Acer/Documents/ESPE/7mo%20-%208vo/Sw%20Seguro/III%20Parcial/app-reservas-Sonnar/.github/workflows/sonarqube.yml): Ejecuta el análisis estático en SonarQube en ramas principales (`main`, `develop`) y pull requests. Bloquea el pipeline si no se cumple el Quality Gate (`sonar.qualitygate.wait=true`).
- [telegram-notify.yml](file:///c:/Users/Acer/Documents/ESPE/7mo%20-%208vo/Sw%20Seguro/III%20Parcial/app-reservas-Sonnar/.github/workflows/telegram-notify.yml): Envía una notificación formateada al grupo de Telegram detallando el commit y los archivos modificados.

#### Configuración de Secretos en GitHub:
Para que los pipelines se ejecuten correctamente en GitHub Actions, debe ir a su repositorio en GitHub: **Settings** -> **Secrets and variables** -> **Actions** y crear los siguientes secretos (**Repository Secrets**):

1. `SONAR_TOKEN`: El token generado en SonarQube.
2. `SONAR_HOST_URL`: La URL pública de su servidor SonarQube (si es local, puede usar un túnel tipo ngrok o configurar un runner propio local).
3. `TELEGRAM_BOT_TOKEN`: El token HTTP obtenido de @BotFather.
4. `TELEGRAM_CHAT_ID`: El ID del grupo de Telegram obtenido (ej. `-100XXXXXXXXXX`).

