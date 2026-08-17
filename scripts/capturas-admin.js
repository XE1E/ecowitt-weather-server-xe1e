const { chromium } = require('playwright');
const fs = require('fs');

// Credenciales por variable de entorno: este script vive en un repo publico.
//   ADMIN_USER=xe1e ADMIN_PASSWORD=... node scripts/capturas-admin.js
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_USER || !ADMIN_PASSWORD) {
  console.error('Falta ADMIN_USER o ADMIN_PASSWORD en el entorno.');
  console.error('Uso: ADMIN_USER=xxx ADMIN_PASSWORD=yyy node scripts/capturas-admin.js');
  process.exit(1);
}

(async () => {
  const adminPages = [
    { url: 'https://clima.xe1e.net/admin', name: 'admin-01-dashboard' },
    { url: 'https://clima.xe1e.net/admin/estaciones', name: 'admin-02-estaciones' },
    { url: 'https://clima.xe1e.net/admin/alertas', name: 'admin-03-alertas' },
    { url: 'https://clima.xe1e.net/admin/calibracion', name: 'admin-04-calibracion' },
    { url: 'https://clima.xe1e.net/admin/publicacion', name: 'admin-05-publicacion' },
    { url: 'https://clima.xe1e.net/admin/notificaciones', name: 'admin-06-notificaciones' },
    { url: 'https://clima.xe1e.net/admin/integraciones', name: 'admin-07-integraciones' },
    { url: 'https://clima.xe1e.net/admin/sistema', name: 'admin-08-sistema' },
    { url: 'https://clima.xe1e.net/admin/wizard', name: 'admin-09-wizard' },
  ];

  const browser = await chromium.launch();

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2
  });

  const page = await context.newPage();

  const outputDir = './docs/capturas';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Login primero
  console.log('Haciendo login...');
  await page.goto('https://clima.xe1e.net/admin', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Llenar formulario - inputs sin name/id, usar tipo
  await page.fill('input[type="text"]', ADMIN_USER);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button:has-text("Ingresar")');

  // Esperar navegación después del login
  await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log('Login completado\n');

  for (const { url, name } of adminPages) {
    console.log(`Capturando: ${name} (${url})`);

    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);

      await page.screenshot({
        path: `${outputDir}/${name}.png`,
        fullPage: true
      });

      console.log(`  ✓ ${name}.png`);
    } catch (error) {
      console.error(`  ✗ Error en ${name}:`, error.message);
    }
  }

  await browser.close();
  console.log('\n¡Listo! Capturas de admin en docs/capturas/');
})();
