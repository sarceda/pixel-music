# pixel-music

Dibujá paredes de colores, cada color es una nota. Una pelota rebota con física simple y, cada vez que choca contra una celda dibujada, suena la nota de ese color y la celda desaparece. Las paredes externas también suenan con la nota del color seleccionado.

Un juguete musical web, sin dependencias: HTML + Canvas 2D + Web Audio API. Funciona abriendo el archivo, sin build ni servidor.

## Cómo usarlo

1. Abrí `index.html` (o andá a la [demo en GitHub Pages](https://sarceda.github.io/pixel-music/)).
2. Elegí un color en la paleta de la izquierda (cada color = una nota).
3. Dibujá líneas/paredes sobre la cuadrícula (click o arrastrar).
4. Dala a **▶ Reproducir** y mirá cómo la pelota rebota, suena y va consumiendo las celdas.

## Controles

| Acción | Cómo |
| --- | --- |
| Dibujar | Click o arrastrar sobre la cuadrícula |
| Borrar | Click derecho, o el borrador 🧽 de la paleta |
| Reproducir / pausar | Botón **▶** o `Espacio` |
| Reiniciar pelota | Botón **↺** o `R` |
| Limpiar todo | Botón **✕** o `C` |
| Gravedad on/off | Checkbox o `G` |
| Silenciar | Botón 🔊 o `M` |
| Seleccionar color | Click en la paleta o teclas `1`–`8` |

## Cómo funciona

- **Cuadrícula**: 48 × 30 celdas. Cada celda pintada es un obstáculo sólido.
- **Física**: la pelota es un círculo con velocidad; rebota contra los bordes del lienzo y contra las celdas pintadas. La colisión detecta la celda más cercana, empuja la pelota hacia afuera y refleja la velocidad sobre la normal (con una pequeña amortiguación). La celda golpeada **desaparece** tras el rebote. Gravedad opcional.
- **Sonido**: Web Audio genera cada nota con un oscilador + envolvente corta y una reverberación sutil. Las notas están limitadas en frecuencia para evitar disparos en ráfaga.

## Mapa de colores → notas

Escala pentatónica de Do mayor (suena bien con cualquier dibujo):

| Color | Nota | Frecuencia |
| --- | --- | --- |
| Rojo `#ff5252` | C4 | 261.63 Hz |
| Naranja `#ff8a3d` | D4 | 293.66 Hz |
| Amarillo `#ffd740` | E4 | 329.63 Hz |
| Verde `#69f0ae` | G4 | 392.00 Hz |
| Turquesa `#40e0d0` | A4 | 440.00 Hz |
| Azul `#40a9ff` | C5 | 523.25 Hz |
| Violeta `#b388ff` | D5 | 587.33 Hz |
| Rosa `#ff6fb5` | E5 | 659.25 Hz |

## Estructura

```
pixel-music/
├── index.html   # markup
├── style.css    # tema oscuro + layout
├── script.js    # lógica: dibujo, física, audio
└── README.md
```

## Ideas para iterar

- Grabar/exportar la secuencia de notas como MIDI.
- Más escalas (menor, blues, modos).
- Pelotas múltiples con colores propios.
- Colisión con las líneas en vez de celdas sólidas.
- Velocidad/gravedad por color.

## Licencia

MIT — ver [LICENSE](LICENSE).
