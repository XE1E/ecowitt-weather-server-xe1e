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
  /* --alarma es el rojo de AVISO y --red el del contorno del reloj, que marca la zona
     tactil principal. Estuvieron siendo el mismo (#ff4128) y eso tenia dos problemas: ese
     tono es un rojo ANARANJADO --matiz ~8 grados-- asi que al teñir el termometro naranja
     de EXT el cambio apenas se notaba, y ademas mezclaba dos significados en un color.
     El de alarma pasa a rojo puro (matiz 0): contra el naranja, el azul y el morado de los
     glifos se distingue de golpe, que es lo unico que se le pide. */
  .cns{--t:#f97316;--h:#3b82f6;--p:#a78bfa;--r:#38bdf8;--v:#22c55e;--y:#ffcf19;--w:#eaeaea;--lbl:#8a8a8a;--red:#ff4128;--alarma:#ff1414;
    /* La remota va en AZUL y no en el gris que tenia. Con el contorno como unica senal de
       grupo --se probo tenir el fondo y no sirve, ver abajo-- el gris #6b7280 era el que
       menos se veia de los cinco en el panel del kiosco, que aplasta los tonos oscuros.
       Un azul claro tiene bastante mas contraste sobre negro. Es el 400 y no el 500 de la
       humedad (--h), para que un borde no se confunda con el color de una cifra. */
    --brd-main:#fbbf24;--brd-jardin:#4ade80;--brd-remota:#60a5fa;--brd-derivada:#ffffff;--brd-reloj:#ff4128;
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
  /* Las celdas van a NEGRO PURO, y no con un tono muy leve del color de su grupo: se
     probo (fondo al 6-8% del tono del borde) y en el panel del kiosco NO SE VE. Medido: el
     JPEG conserva los valores con fidelidad --se pidio #140f03 y llega #130f03--, asi que
     no es el renderer ni la compresion; es que pintar RGB 3-20 sobre 255 cae en el fondo
     de la curva de tonos y un LCD con retroiluminacion no resuelve nada por debajo de
     ~25-30. En un monitor de PC se adivina; en la pantalla no. Para que se viera habria
     que subirlo a RGB 35-50, que ya deja de ser un tono leve y se come el negro de la
     consola. Si algun dia hace falta marcar el grupo con mas fuerza, la via es una franja
     solida en un canto de la celda, que si tiene contraste. */
  /* Contorno de 3 px y no de 2: con el fondo descartado, el borde es la UNICA senal de a
     que grupo pertenece la celda, y en el panel del kiosco 2 px se quedaban finos. No
     descuadra la rejilla de 1024 aunque no haya box-sizing:border-box, porque las celdas
     son grid items estirados y el borde se dibuja hacia dentro: cada celda pierde 2 px de
     interior, no de caja. Donde eso se nota es en la fila SOLAR/UV/IMECA, ajustada al
     pixel, que pasa de ~7 px de holgura por celda a ~5. */
  .cns .cell{background:#000;position:relative;padding:9px 12px;overflow:hidden;min-width:0;min-height:0;border-radius:12px;border:3px solid transparent}
  .cns .cell.main{border-color:var(--brd-main)}
  .cns .cell.jardin{border-color:var(--brd-jardin)}
  .cns .cell.remota{border-color:var(--brd-remota)}
  /* derivada = lo que no es una lectura cruda de un sensor de la estación: la
     condición del cielo, la luna, y solar/UV/ICA (el ICA ni siquiera es nuestro,
     lo estima el backend). Rocío y sensación SALIERON de este grupo: se derivan de
     la temperatura y la humedad de la principal, así que llevan su amarillo. */
  .cns .cell.derivada{border-color:var(--brd-derivada)}
  /* El reloj lleva el contorno MÁS GRUESO de la consola (5 px contra 3): es puro
     adorno, y se lo puede permitir porque es la única celda que no muestra una
     magnitud, así que engrosarla no le quita sitio a ningún número. Sube con las demás
     para conservar la diferencia: a 4 contra 3 ya no se notaba que era la destacada. */
  .cns .cell.reloj{border-color:var(--brd-reloj);border-width:5px}
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
