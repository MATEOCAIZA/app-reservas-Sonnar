const { execSync } = require('child_process');
const fs = require('fs');
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

const commitSha = process.env.COMMIT_SHA    || getGitVal('git rev-parse HEAD', 'desconocido');
const branch    = process.env.BRANCH        || getGitVal('git rev-parse --abbrev-ref HEAD', 'desconocido');
const author    = process.env.AUTHOR        || getGitVal('git log -1 --format="%an"', 'desconocido');
const message   = process.env.COMMIT_MESSAGE || getGitVal('git log -1 --format="%s"', 'sin mensaje');
const repo      = (process.env.REPOSITORY   || getGitVal('git config --get remote.origin.url', 'MATEOCAIZA/app-reservas-Sonnar'))
  .replace(/^git@github\.com:/, '')
  .replace(/^https:\/\/github\.com\//, '')
  .replace(/\.git$/, '')
  .trim();
const runUrl = process.env.RUN_URL || '';

// ─── Lectura y parseo del reporte de ZAP ──────────────────────────────────────
// zaproxy/action-baseline genera por defecto report_json.json (junto con
// report_html.html y report_md.md), ya con permisos de escritura preparados.
// El reporte JSON de ZAP Baseline Scan tiene la forma:
// { site: [ { alerts: [ { name, riskcode, riskdesc, count, ... } ] } ] }
const RISK_LABELS = {
  3: { emoji: '🔴', label: 'High' },
  2: { emoji: '🟠', label: 'Medium' },
  1: { emoji: '🟡', label: 'Low' },
  0: { emoji: 'ℹ️', label: 'Informational' },
};

function loadZapReport(path) {
  try {
    const raw = fs.readFileSync(path, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function summarizeAlerts(zapReport) {
  const counts = { 3: 0, 2: 0, 1: 0, 0: 0 };
  const alerts = [];

  const sites = (zapReport && zapReport.site) || [];
  for (const site of sites) {
    for (const alert of site.alerts || []) {
      const riskcode = Number(alert.riskcode);
      if (counts[riskcode] === undefined) continue;
      counts[riskcode] += 1;
      alerts.push({
        name: alert.name || alert.alert || 'Alerta sin nombre',
        riskcode,
        instances: Array.isArray(alert.instances) ? alert.instances.length : (alert.count || '–'),
      });
    }
  }

  // Alertas más severas primero
  alerts.sort((a, b) => b.riskcode - a.riskcode);

  return { counts, alerts };
}

function buildZapSection(zapReport) {
  if (!zapReport) {
    return '⚠️ *DAST (OWASP ZAP):* No se pudo leer `report_json.json` (¿falló el escaneo antes de generarlo?).';
  }

  const { counts, alerts } = summarizeAlerts(zapReport);
  const totalHighMedium = counts[3] + counts[2];

  let section = totalHighMedium > 0
    ? `⚠️ *DAST (OWASP ZAP):* se detectaron hallazgos de severidad alta/media.`
    : `✅ *DAST (OWASP ZAP):* sin hallazgos de severidad alta o media.`;

  section += '\n\n📊 *Resumen de alertas:*\n';
  for (const code of [3, 2, 1, 0]) {
    const { emoji, label } = RISK_LABELS[code];
    section += `  ${emoji} ${label}: \`${counts[code]}\`\n`;
  }

  const topAlerts = alerts.filter(a => a.riskcode >= 2).slice(0, 8);
  if (topAlerts.length > 0) {
    section += '\n🔎 *Principales hallazgos (High/Medium):*\n';
    for (const a of topAlerts) {
      const { emoji } = RISK_LABELS[a.riskcode];
      section += `  ${emoji} ${a.name} (${a.instances} instancia(s))\n`;
    }
  }

  return section.trim();
}

// ─── Construcción y envío del mensaje ────────────────────────────────────────
async function main() {
  const zapReport = loadZapReport('report_json.json');
  const zapSection = buildZapSection(zapReport);

  const commitUrl = `https://github.com/${repo}/commit/${commitSha}`;
  const shortSha = commitSha.length > 7 ? commitSha.slice(0, 7) : commitSha;

  const telegramMessage = [
    `🕷️ *Nuevo escaneo DAST en el repositorio*`,
    ``,
    `👤 *Autor:*    ${author}`,
    `🌿 *Rama:*     ${branch}`,
    `📝 *Mensaje:*  ${message}`,
    `🔗 *Commit:*   [${shortSha}](${commitUrl})`,
    runUrl ? `⚙️ *Run:*      [Ver ejecución](${runUrl})` : '',
    ``,
    zapSection,
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
          console.log('✅ Notificación de Telegram (DAST) enviada exitosamente.');
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
