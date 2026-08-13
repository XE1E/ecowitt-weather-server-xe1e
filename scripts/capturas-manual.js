const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  // 15 páginas web del sitio
  const urls = [
    { url: 'https://clima.xe1e.net/pro', name: '01-inicio' },
    { url: 'https://clima.xe1e.net/pro/tablero', name: '02-tablero' },
    { url: 'https://clima.xe1e.net/pro/pronostico', name: '03-pronostico' },
    { url: 'https://clima.xe1e.net/pro/historia', name: '04-historia' },
    { url: 'https://clima.xe1e.net/pro/estadisticas', name: '05-estadisticas' },
    { url: 'https://clima.xe1e.net/pro/tablas', name: '06-tablas' },
    { url: 'https://clima.xe1e.net/pro/climatologia', name: '07-climatologia' },
    { url: 'https://clima.xe1e.net/pro/radar', name: '08-radar' },
    { url: 'https://clima.xe1e.net/pro/camara', name: '09-camara' },
    { url: 'https://clima.xe1e.net/pro/astronomia', name: '10-astronomia' },
    { url: 'https://clima.xe1e.net/pro/calidad-aire', name: '11-calidad-aire' },
    { url: 'https://clima.xe1e.net/pro/aeronautica', name: '12-aeronautica' },
    { url: 'https://clima.xe1e.net/pro/remota', name: '13-remota' },
    { url: 'https://clima.xe1e.net/pro/compartir', name: '14-widget' },
    { url: 'https://clima.xe1e.net/pro/consola', name: '15-consola' },
  ];

  const browser = await chromium.launch();

  // Pantalla HD con escala 2x para calidad
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2
  });

  const page = await context.newPage();

  // Crear carpeta para las capturas
  const outputDir = './docs/capturas';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const { url, name } of urls) {
    console.log(`Capturando: ${name} (${url})`);

    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000); // Esperar animaciones y datos

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
  console.log('\n¡Listo! Capturas en docs/capturas/');
})();
