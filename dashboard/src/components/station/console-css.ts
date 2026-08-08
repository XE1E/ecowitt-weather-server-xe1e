/**
 * El CSS de la consola, compartido.
 *
 * Vivía dentro de `ConsoleReplica` como una plantilla de texto, que estaba bien
 * mientras la consola era la única pantalla con esta estética. Ahora las páginas de
 * detalle del kiosco cuelgan de ella --se llega tocando una celda-- y tienen que
 * verse como la misma máquina: mismos colores por variable, misma fuente de siete
 * segmentos en las cifras, mismo negro. Duplicar el bloque habría garantizado que
 * los dos se separaran al primer retoque.
 *
 * Todo va bajo `.cns`, así que basta con poner esa clase en el contenedor raíz para
 * heredarlo. Ojo con las comillas invertidas: esto es una plantilla de JavaScript y
 * una suelta dentro de un comentario la corta en seco.
 */
export const CONSOLE_CSS = `
  @font-face{font-family:'DSEG7';src:url('/fonts/DSEG7Classic-Bold.woff2') format('woff2');font-display:block}
  /* DSEG14: sólo para el RUMBO del viento. Con siete segmentos no se pueden dibujar
     la N ni la O a altura completa; con catorce sí, porque añaden diagonales. Ver
     public/fonts/README.md. */
  @font-face{font-family:'DSEG14';src:url('/fonts/DSEG14Classic-Bold.woff2') format('woff2');font-display:block}
  .cns{--t:#f97316;--h:#3b82f6;--p:#a78bfa;--r:#38bdf8;--v:#22c55e;--y:#ffcf19;--w:#eaeaea;--lbl:#8a8a8a;--red:#ff4128;
    /* La remota pasa de gris a AZUL. Con el fondo por grupo, el gris no daba: un gris al
       7% sobre negro es indistinguible del blanco al 5% de la derivada, así que su fondo
       tuvo que tirar a azul y la celda se quedaba con borde gris y fondo azul, la única
       del tablero que no seguía su propio color. El azul es el 400 y no el 500 de la
       humedad (--h) para que un borde no se confunda con el color de una cifra. */
    --brd-main:#fbbf24;--brd-jardin:#4ade80;--brd-remota:#60a5fa;--brd-derivada:#ffffff;--brd-reloj:#ff4128;
    /* Fondo de cada grupo: el MISMO tono que su borde, a un 6-8% sobre negro. Así no hay
       un segundo código de color que aprender --el borde ya dice de quién es la celda-- y
       el fondo sólo lo hace legible de un vistazo, sin tener que seguir un contorno de
       2 px. Se dan como hex ya compuesto sobre negro y no como rgba para que el resultado
       no dependa de lo que haya detrás de la celda.
       La REMOTA es la excepción al "mismo tono": su borde es gris y un gris al 7% sobre
       negro es indistinguible del blanco al 5% de la derivada, así que se tira a azul.
       Son los cinco valores a tocar si el efecto queda fuerte o flojo. */
    --bg-main:#140f03;--bg-jardin:#06120a;--bg-remota:#070c12;--bg-derivada:#0d0d0d;--bg-reloj:#120503;
    font-family:'Roboto Condensed','Arial Narrow','Segoe UI',system-ui,sans-serif;font-variant-numeric:tabular-nums}
  .cns .lbl{color:var(--lbl);font-size:18px;font-weight:700;letter-spacing:2px;line-height:1}
  .cns .lbl .ac{color:var(--t)} .cns .lbl .acg{color:var(--v)}
  .cns .big{font-weight:800;line-height:.82;letter-spacing:-1px}
  /* Números en fuente 7-segmentos (DSEG). Clases de glow por variable meteorológica */
  .cns .seg,.cns .big,.cns .gt,.cns .gh,.cns .gp,.cns .gr,.cns .gv,.cns .gy{font-family:'DSEG7','Roboto Condensed',monospace}
  /* Catorce segmentos, para TEXTO con letras. Va aparte de la clase .seg a propósito:
     esa es para cifras y arrastra DSEG7. */
  .cns .seg14{font-family:'DSEG14','Roboto Condensed',monospace}
  .cns .gt{color:var(--t);text-shadow:0 0 12px rgba(249,115,22,.55)}
  .cns .gh{color:var(--h);text-shadow:0 0 12px rgba(59,130,246,.55)}
  .cns .gp{color:var(--p);text-shadow:0 0 12px rgba(167,139,250,.55)}
  .cns .gr{color:var(--r);text-shadow:0 0 12px rgba(56,189,248,.55)}
  .cns .gv{color:var(--v);text-shadow:0 0 12px rgba(34,197,94,.55)}
  .cns .gy{color:var(--y);text-shadow:0 0 12px rgba(255,207,25,.5)}
  .cns .gw{color:var(--w);text-shadow:0 0 10px rgba(234,234,234,.35)}
  .cns .u{font-weight:700;vertical-align:top;font-family:'Roboto Condensed','Arial Narrow',system-ui,sans-serif} .cns .ured{color:var(--red)}
  .cns .dec{font-size:0.6em}          /* decimales en tamaño más chico */
  /* Las cifras grandes (EXT y VEL) llevan el decimal a la MITAD del entero, no al
     0.6em del resto: a ese tamaño y sobre 76 px el decimal competía con los
     enteros. La proporción es la de una consola física, donde el decimal se lee
     como accesorio del número. Los mín/máx conservan el .dec de 0.6em. */
  .cns .decxs .dec{font-size:0.5em}
  .cns .rt{text-align:right}          /* valor pegado al borde derecho */
  .cns .cell{background:#000;position:relative;padding:9px 12px;overflow:hidden;min-width:0;min-height:0;border-radius:12px;border:2px solid transparent}
  .cns .cell.main{background:var(--bg-main);border-color:var(--brd-main)}
  .cns .cell.jardin{background:var(--bg-jardin);border-color:var(--brd-jardin)}
  .cns .cell.remota{background:var(--bg-remota);border-color:var(--brd-remota)}
  /* derivada = lo que no es una lectura cruda de un sensor de la estación: la
     condición del cielo, la luna, y solar/UV/ICA (el ICA ni siquiera es nuestro,
     lo estima el backend). Rocío y sensación SALIERON de este grupo: se derivan de
     la temperatura y la humedad de la principal, así que llevan su amarillo. */
  .cns .cell.derivada{background:var(--bg-derivada);border-color:var(--brd-derivada)}
  /* El reloj lleva el contorno MÁS GRUESO de la consola (4 px contra 2): es puro
     adorno, y se lo puede permitir porque es la única celda que no muestra una
     magnitud, así que engrosarla no le quita sitio a ningún número. */
  .cns .cell.reloj{background:var(--bg-reloj);border-color:var(--brd-reloj);border-width:4px}
  .cns .col{display:flex;flex-direction:column}
  .cns .ctr{margin-top:auto;margin-bottom:auto}
  .cns .bt{display:flex;justify-content:space-between;align-items:flex-start}

  /* ── Páginas de detalle (las que cuelgan de la consola) ────────────────────
     Comparten el negro y la tipografía, pero no la rejilla: aquí manda una
     cabecera, un cuerpo grande y la barra de botones al pie. */
  .cns .khead{display:flex;align-items:baseline;justify-content:space-between;
    padding:10px 18px 8px;border-bottom:2px solid var(--acc)}
  .cns .ktit{font-size:26px;font-weight:800;letter-spacing:3px;color:var(--acc)}
  .cns .ksub{font-size:17px;font-weight:700;letter-spacing:2px;color:var(--lbl)}
  /* Fila de cifras destacadas. El rótulo va arriba y pequeño, la cifra abajo y
     enorme: es el mismo reparto que las celdas de la consola. */
  .cns .kpis{display:flex;gap:10px;padding:10px 18px 4px}
  .cns .kpi{flex:1;min-width:0}
  .cns .kpi .k{font-size:15px;font-weight:700;letter-spacing:2px;color:var(--lbl);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cns .kpi .v{font-size:42px;font-weight:800;line-height:1;margin-top:4px}
  /* Barra de botones: 64 px, los mismos que la barra de pestañas de las páginas
     clásicas, para que el dedo encuentre lo mismo en toda la pantalla. */
  .cns .kbar{display:flex;height:64px;border-top:1px solid #222;flex-shrink:0}
  .cns .kbtn{flex:1;display:flex;align-items:center;justify-content:center;
    font-size:19px;font-weight:700;letter-spacing:2px;color:#8a8a8a;
    border-right:1px solid #222;background:#000}
  .cns .kbtn:last-child{border-right:none}
  /* El botón ACTIVO no es zona táctil (ya estás ahí): se marca en el color de la
     variable para que se vea dónde estás sin leer la cabecera. */
  .cns .kbtn.on{color:#000;background:var(--acc)}
  .cns .kbtn.back{color:var(--w);letter-spacing:1px}
`
