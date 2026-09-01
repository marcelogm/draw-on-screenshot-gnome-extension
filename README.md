# Draw on Screenshot (GNOME Shell Extension)

Dibuja y anota directamente sobre la interfaz nativa interactiva de captura de pantalla de GNOME (`Main.screenshotUI`) al estilo **Lightshot**, con herramientas vectoriales, atajos de teclado, paleta de colores con popover, control de grosor y atenuación dinámica de menús.

Compatible con **GNOME Shell 45, 46, 47, 48, 49 y 50**.

---

## ✨ Características

- ✏️ **Lápiz Libre (Pen)**: Trazo fluido a mano alzada (`P` / `D`).
- 📏 **Línea Recta (Line)**: Trazado limpio de punto a punto (`L`).
- ↗️ **Flecha Geométrica (Arrow)**: Flecha con punta sólida sin sobrepasar el cuerpo (`A`).
- 🔲 **Rectángulo (Rect)**: Recuadro vectorial (`R`).
- 🖍️ **Resaltador (Highlighter)**: Marcador translúcido para destacar texto (`H`).
- 🔤 **Texto Interactivo (Text)**: Entrada de texto en pantalla con `Enter` para confirmar y `Esc` para cancelar (`T`).
- 🎨 **Selector de Color Compacto con Popover**: Botón único con paleta de 8 colores desplegable (`C` para alternar colores).
- 📏 **Controlador de Tamaño de Trazo**: Botones `[-]` y `[+]` con soporte de **scroll del ratón** para regular el grosor al vuelo (`+` / `-`).
- ↩️ **Deshacer Global (`Ctrl + Z`)**: Reversión paso a paso de los trazos.
- 🗑️ **Limpiar Lienzo (`Supr` / `Backspace`)**: Borrado total.
- 🌫️ **Atenuación Dinámica (Fade Opacity)**: Los menús se vuelven automáticamente translúcidos (`opacity: 60`) mientras dibujas para no obstruir el contenido debajo.
- 🚀 **100% Nativo & HiDPI**: Compositing 2D directo con Cairo sobre el framebuffer antes de guardar en disco o copiar al portapapeles.

---

## ⌨️ Atajos de Teclado

| Atajo | Acción |
| :--- | :--- |
| **`P`** o **`D`** | Activar Lápiz libre |
| **`L`** | Activar Línea recta |
| **`A`** | Activar Flecha |
| **`R`** | Activar Rectángulo |
| **`H`** | Activar Resaltador |
| **`T`** | Activar Texto |
| **`C`** | Alternar color siguiente |
| **`+` / `-`** | Aumentar / Disminuir grosor |
| **`Ctrl + Z`** | Deshacer último trazo |
| **`Supr` / `Backspace`** | Limpiar todo |

---

## 📦 Instalación Local

1. Cloná o enlazá este repositorio en la carpeta de extensiones de GNOME:
   ```bash
   git clone https://github.com/ricardojparram/draw-on-screenshot-gnome-extension.git ~/.local/share/gnome-shell/extensions/draw-on-screenshot@ricardojparram
   ```

2. Recargá la sesión de GNOME:
   - **Wayland**: Cerrá sesión (Log Out) y volvé a entrar.
   - **X11**: Presioná `Alt + F2`, escribí `r` y presioná `Enter`.

3. Habilitá la extensión:
   ```bash
   gnome-extensions enable draw-on-screenshot@ricardojparram
   ```

---

## 🏗️ Arquitectura del Código

```
├── metadata.json                 # Metadatos y versiones soportadas
├── stylesheet.css                # Estilos nativos GNOME Adwaita Dark
├── extension.js                  # Entrypoint del ciclo de vida (Extension class)
└── src/
    ├── core/
    │   ├── drawingModel.js       # Modelo de estado, herramientas, colores y pila Undo
    │   └── compositor.js         # Compositor Cairo sobre GdkPixbuf
    ├── ui/
    │   ├── drawingCanvas.js      # St.DrawingArea interactivo con renderizado Cairo
    │   └── drawingToolbar.js     # Barra flotante con herramientas y popovers
    └── patcher.js                # Interceptor de Main.screenshotUI y router de eventos
```

---

## 📄 Licencia

GPL-3.0-or-later
