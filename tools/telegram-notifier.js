const { execSync } = require('child_process');
const https = require('https');

// ─── Credenciales ────────────────────────────────────────────────────────────
const token = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
  console.error('Error: TELEGRAM_TOKEN y TELEGRAM_CHAT_ID son requeridos como variables de entorno');
  process.exit(1);
}

// ─── Datos del commit ─────────────────────────────────────────────────────────
const getGitVal = (cmd, fallback) => {
  try {
    return execSync(cmd).toString().trim();
  } catch (e) {
    return fallback;
  }
};

const commitSha   = process.env.COMMIT_SHA    || getGitVal('git rev-parse HEAD', 'desconocido');
const branch      = process.env.BRANCH        || getGitVal('git rev-parse --abbrev-ref HEAD', 'desconocido');
const author      = process.env.AUTHOR        || getGitVal('git log -1 --format="%an"', 'desconocido');
const message     = process.env.COMMIT_MESSAGE || getGitVal('git log -1 --format="%s"', 'sin mensaje');
const repo        = (process.env.REPOSITORY   || getGitVal('git config --get remote.origin.url', 'MATEOCAIZA/app-reservas-Sonnar'))
  .replace(/^git@github\.com:/, '')
  .replace(/^https:\/\/github\.com\//, '')
  .replace(/\.git$/, '')
  .trim();

// ─── Archivos modificados ─────────────────────────────────────────────────────
let filesList = '';
try {
  filesList = execSync(`git diff-tree --no-commit-id --name-only -r ${commitSha}`)
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(f => `  • ${f}`)
    .slice(0, 15)
    .join('\n');
} catch (e) {
  filesList = '  • No se pudo obtener la lista de archivos.';
}

// ─── Quality Gate status ──────────────────────────────────────────────────────
// QUALITY_GATE_STATUS = 'success' | 'failure'  (viene de steps.quality_gate.outcome en el workflow)
const gateOutcome = (process.env.QUALITY_GATE_STATUS || 'unknown').toLowerCase();
const gatePassed  = gateOutcome === 'success';

// ─── Consulta a la API de SonarQube para métricas fallidas ───────────────────
/**
 * Hace una petición HTTPS GET y devuelve el body parseado como JSON.
 * Devuelve null si falla o si no están configuradas las credenciales.
 */
function fetchJson(url, sonarToken) {
  return new Promise((resolve) => {
    const auth = Buffer.from(`${sonarToken}:`).toString('base64');
    const req = https.request(url, { headers: { Authorization: `Basic ${auth}` } }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

/** Etiqueta legible para cada métrica de SonarQube */
const METRIC_LABELS = {
  blocker_violations:           'Blocker Issues',
  critical_violations:          'Critical Issues',
  major_violations:             'Major Issues',
  security_hotspots_reviewed:   'Security Hotspots Reviewed',
  coverage:                     'Cobertura',
  duplicated_lines_density:     'Líneas duplicadas (%)',
  sqale_debt_ratio:             'Ratio deuda técnica',
  complexity:                   'Complejidad ciclomática',
  cognitive_complexity:         'Complejidad cognitiva',
};

/**
 * Construye la sección de detalle del Quality Gate:
 * - Si pasó → ✅ mensaje de éxito
 * - Si falló → consulta la API y lista las condiciones fallidas con valor vs umbral
 */
async function buildQualityGateSection(sonarHostUrl, sonarToken, projectKey) {
  if (gatePassed) {
    return '✅ *Quality Gate:* APROBADO — el código cumple todos los estándares.';
  }

  let detail = '❌ *Quality Gate:* FALLIDO\n';

  if (!sonarHostUrl || !sonarToken || !projectKey) {
    detail += '_No se pudo obtener el detalle (faltan credenciales/project key)._';
    return detail;
  }

  const apiUrl = `${sonarHostUrl}/api/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}`;
  const json = await fetchJson(apiUrl, sonarToken);

  if (!json || !json.projectStatus || !json.projectStatus.conditions) {
    detail += '_No se pudo obtener el detalle de las métricas._';
    return detail;
  }

  const failedConditions = json.projectStatus.conditions.filter(c => c.status === 'ERROR');

  if (failedConditions.length === 0) {
    detail += '_API no reportó condiciones fallidas._';
    return detail;
  }

  detail += '\n📊 *Métricas que no superaron el umbral:*\n';
  for (const cond of failedConditions) {
    const label     = METRIC_LABELS[cond.metricKey] || cond.metricKey;
    const actual    = cond.actualValue  !== undefined ? cond.actualValue  : '–';
    const threshold = cond.errorThreshold !== undefined ? cond.errorThreshold : '–';
    const op        = cond.comparator === 'GT' ? '>' : cond.comparator === 'LT' ? '<' : cond.comparator;
    detail += `  ❌ *${label}*: valor \`${actual}\` (umbral: ${op} \`${threshold}\`)\n`;
  }

  return detail.trim();
}

// ─── Construcción y envío del mensaje ────────────────────────────────────────
async function main() {
  const sonarHostUrl = process.env.SONAR_HOST_URL || '';
  const sonarToken   = process.env.SONAR_TOKEN    || '';

  // Intentamos leer el project key del report-task.txt que deja el scanner
  let projectKey = '';
  try {
    const report = require('fs').readFileSync('.sonar/report-task.txt', 'utf8');
    const match  = report.match(/^projectKey=(.+)$/m);
    if (match) projectKey = match[1].trim();
  } catch {
    // Si no existe el archivo (ejecución local sin scanner) dejamos vacío
  }

  const commitUrl         = `https://github.com/${repo}/commit/${commitSha}`;
  const sonarProjectUrl   = sonarHostUrl && projectKey
    ? `${sonarHostUrl}/dashboard?id=${encodeURIComponent(projectKey)}`
    : null;

  const qualityGateSection = await buildQualityGateSection(sonarHostUrl, sonarToken, projectKey);

  const shortSha = commitSha.length > 7 ? commitSha.slice(0, 7) : commitSha;

  const telegramMessage = [
    `📢 *Nuevo análisis en el repositorio*`,
    ``,
    `👤 *Autor:*    ${author}`,
    `🌿 *Rama:*     ${branch}`,
    `📝 *Mensaje:*  ${message}`,
    `🔗 *Commit:*   [${shortSha}](${commitUrl})`,
    sonarProjectUrl ? `📈 *SonarQube:* [Ver proyecto](${sonarProjectUrl})` : '',
    ``,
    `📂 *Archivos modificados:*`,
    filesList || '  • Ninguno',
    ``,
    qualityGateSection,
  ].filter(line => line !== null).join('\n').trim();

  // ─── Envío a Telegram ───────────────────────────────────────────────────────
  const data = JSON.stringify({
    chat_id: chatId,
    text: telegramMessage,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };

  await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('✅ Notificación de Telegram enviada exitosamente.');
          resolve();
        } else {
          console.error(`❌ Error al enviar a Telegram. Código: ${res.statusCode}`);
          console.error('Respuesta:', body);
          reject(new Error(`Telegram HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', (err) => {
      console.error('❌ Error de red al enviar a Telegram:', err.message);
      reject(err);
    });
    req.write(data);
    req.end();
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
