# Draw on Screenshot (GNOME Shell Extension)

Dibuja y anota directamente sobre la interfaz nativa interactiva de captura de pantalla de GNOME (`Main.screenshotUI`) al estilo **Lightshot**, con herramientas vectoriales, atajos de teclado, paleta de colores desplegable, control de grosor y atenuación dinámica de menús.

Compatible con **GNOME Shell 48, 49 y 50**.

> El código usa APIs que no existen antes de GNOME 48 (`St.BoxLayout.orientation`,
> `global.stage.context`), así que declarar 45–47 era incorrecto: ahí no funciona.
> Verificado en 50; 48 y 49 se declaran por compatibilidad de API.

---

## ✨ Características

- ✏️ **Lápiz libre**: trazo fluido a mano alzada (`P` / `D`).
- 📏 **Línea recta**: punto a punto (`L`).
- ↗️ **Flecha**: punta sólida que no sobrepasa el cuerpo (`A`).
- 🔲 **Rectángulo**: recuadro vectorial sin relleno (`R`).
- 🖍️ **Resaltador**: marcador translúcido (`H`).
- 🔤 **Texto**: entrada en pantalla, `Enter` confirma y `Esc` cancela (`T`).
- 🎨 **Paleta flotante**: botón compacto con 8 colores (`C` para rotar). Se abre como
  overlay sobre el stage, sin ensanchar la barra.
- 📏 **Grosor de trazo**: botones `[-]` / `[+]`, rueda del ratón, y `Ctrl` + rueda
  en cualquier punto de la pantalla.
- 🎯 **Preview del pincel**: círculo bajo el cursor con el grosor y color reales.
- ↩️ **Deshacer y rehacer**: `Ctrl+Z` y `Ctrl+Shift+Z`.
- 🗑️ **Limpiar lienzo** (`Supr` / `Retroceso`), reversible con deshacer.
- 🌫️ **Atenuación dinámica**: los menús se vuelven translúcidos mientras dibujás.
- 🚀 **Nativo y HiDPI**: compositing 2D con Cairo antes de guardar en disco o copiar al portapapeles.

La barra de dibujo **está siempre visible** mientras la UI de captura está abierta,
centrada justo encima del panel nativo de modos.

**Ninguna herramienta viene activada de fábrica.** Mientras no elijas una, el
lienzo es inerte y la captura se comporta exactamente como la nativa: si sólo
querés capturar, no hay nada que esquivar. Al pulsar una herramienta el lienzo se
activa; al volver a pulsarla se desactiva.

### Cómo convive el dibujo con la selección de área

El lienzo cubre **toda la pantalla**: se puede dibujar donde sea, también fuera del
área seleccionada.

Para que eso no deje inservible al selector de área nativo, el lienzo sólo es
reactivo cuando hay una herramienta activa. Sin herramienta seleccionada el
lienzo es completamente inerte y los clics llegan al selector como siempre.

Esto importa a nivel técnico: en Clutter el evento se entrega al actor reactivo
más alto, y devolver `EVENT_PROPAGATE` lo pasa al **padre**, nunca a un hermano
que esté debajo. Un lienzo reactivo a pantalla completa no puede devolverle el
evento al selector; sólo dejando de ser reactivo se consigue.

---

## ⌨️ Atajos de Teclado

| Atajo | Acción |
| :--- | :--- |
| **`P`** o **`D`** | Lápiz libre |
| **`L`** | Línea recta |
| **`A`** | Flecha |
| **`R`** | Rectángulo |
| **`H`** | Resaltador |
| **`T`** | Texto |
| **`C`** | Color siguiente |
| **`+`** / **`-`** | Aumentar / disminuir grosor |
| **`Ctrl`** + **rueda** | Aumentar / disminuir grosor |
| **`Ctrl`** + **`Z`** | Deshacer |
| **`Ctrl`** + **`Shift`** + **`Z`** (o **`Ctrl`** + **`Y`**) | Rehacer |
| **`Supr`** / **`Retroceso`** | Limpiar todo |

Los atajos de una sola letra se desactivan mientras escribís una anotación de texto.

---

## 📦 Instalación

```bash
git clone https://github.com/ricardojparram/draw-on-screenshot-gnome-extension.git \
  ~/.local/share/gnome-shell/extensions/draw-on-screenshot@ricardojparram
gnome-extensions enable draw-on-screenshot@ricardojparram
```

Recargá la sesión de GNOME:

- **X11**: `Alt` + `F2`, escribí `r`, `Enter`.
- **Wayland**: cerrá sesión y volvé a entrar — o usá el shell anidado que se
  describe abajo, que no requiere logout.

---

## 🛠️ Desarrollo en Wayland sin cerrar sesión

En Wayland no existe `Alt+F2` → `r`. En GNOME 50 el modo anidado es el **devkit**,
que vive en un paquete aparte:

```bash
sudo dnf install mutter-devkit        # Fedora
```

Sin ese binario, `gnome-shell --devkit` avisa `Failed to launch devkit` y no abre
ventana; y `gnome-shell --wayland` a secas intenta tomar la sesión real y aborta
con `EBUSY`. No hay otra vía de anidado.

Enlazá el repo a la carpeta de extensiones para que el shell lea tus ediciones:

```bash
ln -sfn "$PWD" ~/.local/share/gnome-shell/extensions/draw-on-screenshot@ricardojparram
```

Para una sesión de pruebas aislada, que no toque el dconf ni las extensiones de tu
escritorio diario:

```bash
DEV=~/.local/share/gs-dev
mkdir -p "$DEV/data/gnome-shell/extensions" "$DEV/config"
ln -sfn "$PWD" "$DEV/data/gnome-shell/extensions/draw-on-screenshot@ricardojparram"

XDG_DATA_HOME="$DEV/data" XDG_CONFIG_HOME="$DEV/config" \
  dbus-run-session -- sh -c '
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions "[\"draw-on-screenshot@ricardojparram\"]"
    exec gnome-shell --devkit --wayland
  '
```

Ciclo: editar → cerrar la ventana anidada → relanzar. Logs en otra terminal:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

---

## 🏗️ Arquitectura del Código

```
├── metadata.json                 # Metadatos y versiones soportadas
├── stylesheet.css                # Estilos Adwaita Dark
├── extension.js                  # Entrypoint del ciclo de vida
├── icons/                        # Iconos simbólicos propios (flecha, línea, rect…)
└── src/
    ├── core/
    │   ├── drawingModel.js       # Estado, herramientas, colores, undo/redo
    │   └── compositor.js         # Compositor Cairo sobre GdkPixbuf
    ├── ui/
    │   ├── drawingCanvas.js      # St.DrawingArea interactivo + renderStroke()
    │   └── drawingToolbar.js     # Barra de herramientas
    └── patcher.js                # Interceptor de Main.screenshotUI
```

### Sistemas de coordenadas

Los trazos se guardan **siempre en coordenadas lógicas del stage**. Al estampar:

```
destino = punto * scale - offset
```

donde `offset` ya viene en **píxeles de buffer** (así lo devuelve
`ScreenshotUI._getSelectedGeometry(true)`, que multiplica por `_scale`). Para
capturas de ventana el origen es el *buffer rect* de la ventana por su
`bufferScale`, no el origen del stage.

### Publicación en extensions.gnome.org

Empaquetado (los `--extra-source` son obligatorios: sin ellos `pack` deja fuera
los subdirectorios y la extensión no carga):

```bash
gnome-extensions pack \
  --extra-source=src --extra-source=icons --extra-source=LICENSE \
  --podir=po --gettext-domain=draw-on-screenshot .
```

Comprobación previa con el analizador estático que recomienda el propio sitio:

```bash
pip install -U shexli
shexli draw-on-screenshot@ricardojparram.shell-extension.zip
```

Quedan dos hallazgos conocidos, ambos revisados:

- `EGO-A-005` *(manual_review)* — acceso al portapapeles. Es inherente: la UI
  nativa de captura copia la imagen y sin eso se rompería esa expectativa. La
  guía exige declararlo en la descripción, y `metadata.json` lo declara.
- `EGO-P-003` *(error)* — falso positivo. La regla dice *«for extensions that
  **include** a GSettings Schema»*; esta extensión no define esquema propio,
  sólo lee `org.gnome.desktop.lockdown` del sistema para respetar el bloqueo de
  escritura en disco.

El campo `version` de `metadata.json` no se toca: lo asigna el sitio en cada
subida, y de ahí salen las actualizaciones automáticas.

### Nota de fragilidad

`_saveScreenshot` se sobrescribe replicando lógica interna del Shell. Si una
versión futura cambia esos campos, la extensión lo detecta al habilitarse
(`REQUIRED_UI_FIELDS`) y deja el guardado nativo intacto en lugar de romperlo.
Si el compositing falla en tiempo de ejecución, se guarda la captura **sin**
anotaciones antes que perderla.

---

## 📄 Licencia

GPL-3.0-or-later. Texto completo en [LICENSE](LICENSE).
