const { execSync } = require('child_process');
const https = require('https');

// Read from env or fall back to local git commands
const token = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
  console.error('Error: TELEGRAM_TOKEN y TELEGRAM_CHAT_ID son requeridos como variables de entorno');
  process.exit(1);
}

const getGitVal = (cmd, fallback) => {
  try {
    return execSync(cmd).toString().trim();
  } catch (e) {
    return fallback;
  }
};

const commitSha = process.env.COMMIT_SHA || getGitVal('git rev-parse HEAD', 'desconocido');
const branch = process.env.BRANCH || getGitVal('git rev-parse --abbrev-ref HEAD', 'desconocido');
const author = process.env.AUTHOR || getGitVal('git log -1 --format="%an"', 'desconocido');
const message = process.env.COMMIT_MESSAGE || getGitVal('git log -1 --format="%s"', 'sin mensaje');
const repo = process.env.REPOSITORY || getGitVal('git config --get remote.origin.url', 'MATEOCAIZA/app-reservas-Sonnar')
  .replace(/^git@github\.com:/, '')
  .replace(/^https:\/\/github\.com\//, '')
  .replace(/\.git$/, '')
  .trim();

// Get modified files
let filesList = '';
try {
  // Try getting list of modified files in the commit
  filesList = execSync(`git diff-tree --no-commit-id --name-only -r ${commitSha}`)
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(f => `- ${f}`)
    .slice(0, 15) // Limit listing to 15 files
    .join('\n');
} catch (e) {
  filesList = '- No se pudo obtener la lista de archivos.';
}

const commitUrl = `https://github.com/${repo}/commit/${commitSha}`;

const telegramMessage = `
📢 *Nuevo Commit en el Repositorio*

👤 *Autor:* ${author}
🌿 *Rama:* ${branch}
📝 *Mensaje:* ${message}
🔗 *Enlace:* [Ver Commit en GitHub](${commitUrl})

📂 *Archivos modificados:*
${filesList || '- Ninguno'}
`.trim();

const data = JSON.stringify({
  chat_id: chatId,
  text: telegramMessage,
  parse_mode: 'Markdown',
  disable_web_page_preview: true
});

const options = {
  hostname: 'api.telegram.org',
  port: 443,
  path: `/bot${token}/sendMessage`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log('¡Notificación de Telegram enviada exitosamente!');
    } else {
      console.error(`Error enviar a Telegram. Código de estado: ${res.statusCode}`);
      console.error('Respuesta:', body);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error('Error de red al enviar a Telegram:', err.message);
  process.exit(1);
});

req.write(data);
req.end();
