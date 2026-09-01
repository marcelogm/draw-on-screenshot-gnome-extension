import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import { ToolType, ColorPalette } from '../core/drawingModel.js';

export const DrawingToolbar = GObject.registerClass({
    GTypeName: 'ScreenshotDrawingToolbar',
    Signals: {
        'color-popover-toggled': {},
    },
}, class DrawingToolbar extends St.BoxLayout {
    /**
     * @param {DrawingModel} model
     * @param {string|null} iconsPath Ruta al directorio `icons/` de la extensión.
     * @param {object} params
     */
    _init(model, iconsPath = null, params = {}) {
        super._init({
            style_class: 'screenshot-draw-toolbar',
            orientation: Clutter.Orientation.HORIZONTAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: false,
            y_expand: false,
            reactive: true,
            ...params,
        });

        this._model = model;
        this._iconsPath = iconsPath;
        this._toolButtons = new Map();
        this._colorPopover = null;
        this._colorButton = null;
        this._colorPreviewSwatch = null;
        this._sizeLabel = null;
        this._undoBtn = null;
        this._redoBtn = null;

        this._buildUI();

        this._modelListener = () => this._syncState();
        this._model.addListener(this._modelListener);
        this._syncState();
    }

    /**
     * Construye un St.Icon usando el SVG propio de la extensión cuando existe,
     * y cayendo al icono del tema si no.
     */
    _makeIcon(customName, themeFallback, size) {
        if (this._iconsPath && customName) {
            const path = GLib.build_filenamev([this._iconsPath, `${customName}.svg`]);
            const file = Gio.File.new_for_path(path);
            if (file.query_exists(null)) {
                return new St.Icon({
                    gicon: new Gio.FileIcon({ file }),
                    icon_size: size,
                });
            }
        }
        return new St.Icon({ icon_name: themeFallback, icon_size: size });
    }

    _createSeparator() {
        return new St.Widget({
            style_class: 'screenshot-draw-separator',
        });
    }

    _buildUI() {
        // --- 1. Herramientas ---
        const tools = [
            { id: ToolType.PEN, icon: 'dos-pen-symbolic', fallback: 'document-edit-symbolic', tooltip: 'Lápiz (P / D)' },
            { id: ToolType.LINE, icon: 'dos-line-symbolic', fallback: 'draw-line-symbolic', tooltip: 'Línea (L)' },
            { id: ToolType.ARROW, icon: 'dos-arrow-symbolic', fallback: 'go-next-symbolic', tooltip: 'Flecha (A)' },
            { id: ToolType.RECT, icon: 'dos-rect-symbolic', fallback: 'checkbox-symbolic', tooltip: 'Rectángulo (R)' },
            { id: ToolType.HIGHLIGHTER, icon: 'dos-highlighter-symbolic', fallback: 'edit-select-all-symbolic', tooltip: 'Resaltador (H)' },
            { id: ToolType.TEXT, icon: 'dos-text-symbolic', fallback: 'insert-text-symbolic', tooltip: 'Texto (T)' },
        ];

        for (const tool of tools) {
            const btn = new St.Button({
                style_class: 'screenshot-draw-tool-button',
                can_focus: true,
                track_hover: true,
                toggle_mode: true,
                accessible_name: tool.tooltip,
            });

            btn.set_child(this._makeIcon(tool.icon, tool.fallback, 16));

            btn.connect('clicked', () => {
                this._model.toggleTool(tool.id);
            });

            this.add_child(btn);
            this._toolButtons.set(tool.id, btn);
        }

        this.add_child(this._createSeparator());

        // --- 2. Selector de color: botón compacto + paleta desplegable ---
        const colorBtn = new St.Button({
            style_class: 'screenshot-draw-color-picker-btn',
            can_focus: true,
            track_hover: true,
            accessible_name: 'Elegir color (C)',
        });

        this._colorPreviewSwatch = new St.Widget({
            style_class: 'screenshot-draw-color-swatch',
        });
        colorBtn.set_child(this._colorPreviewSwatch);

        this._colorButton = colorBtn;

        // Se construye aquí pero NO se añade a la barra: el patcher lo cuelga
        // del stage y lo posiciona, para que abrirlo no reacomode la barra.
        this._colorPopover = new St.BoxLayout({
            style_class: 'screenshot-draw-color-popover',
            orientation: Clutter.Orientation.HORIZONTAL,
            visible: false,
            reactive: true,
        });

        for (const color of ColorPalette) {
            const swatchBtn = new St.Button({
                style_class: 'screenshot-draw-popover-color-btn',
                style: `background-color: ${color.hex};`,
                can_focus: true,
                track_hover: true,
                accessible_name: color.name,
            });

            swatchBtn.connect('clicked', () => {
                this._model.setActiveColor(color);
                this._colorPopover.visible = false;
            });

            this._colorPopover.add_child(swatchBtn);
        }

        colorBtn.connect('clicked', () => {
            this._colorPopover.visible = !this._colorPopover.visible;
            this.emit('color-popover-toggled');
        });

        this.add_child(colorBtn);

        this.add_child(this._createSeparator());

        // --- 3. Grosor de trazo ---
        const sizeContainer = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'screenshot-draw-size-stepper',
            reactive: true,
        });

        const decBtn = new St.Button({
            style_class: 'screenshot-draw-stepper-btn',
            can_focus: true,
            track_hover: true,
            accessible_name: 'Reducir tamaño (-)',
        });
        decBtn.set_child(new St.Icon({
            icon_name: 'value-decrease-symbolic',
            icon_size: 14,
        }));
        decBtn.connect('clicked', () => {
            this._model.decreaseSize();
        });

        this._sizeLabel = new St.Label({
            text: `${this._model.activeWidth}px`,
            style_class: 'screenshot-draw-size-label',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });

        const incBtn = new St.Button({
            style_class: 'screenshot-draw-stepper-btn',
            can_focus: true,
            track_hover: true,
            accessible_name: 'Aumentar tamaño (+)',
        });
        incBtn.set_child(new St.Icon({
            icon_name: 'value-increase-symbolic',
            icon_size: 14,
        }));
        incBtn.connect('clicked', () => {
            this._model.increaseSize();
        });

        sizeContainer.connect('scroll-event', (actor, event) => {
            const dir = event.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.UP) {
                this._model.increaseSize();
                return Clutter.EVENT_STOP;
            } else if (dir === Clutter.ScrollDirection.DOWN) {
                this._model.decreaseSize();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        sizeContainer.add_child(decBtn);
        sizeContainer.add_child(this._sizeLabel);
        sizeContainer.add_child(incBtn);
        this.add_child(sizeContainer);

        this.add_child(this._createSeparator());

        // --- 4. Deshacer / Rehacer / Limpiar ---
        this._undoBtn = new St.Button({
            style_class: 'screenshot-draw-tool-button',
            can_focus: true,
            track_hover: true,
            accessible_name: 'Deshacer (Ctrl+Z)',
        });
        this._undoBtn.set_child(new St.Icon({
            icon_name: 'edit-undo-symbolic',
            icon_size: 16,
        }));
        this._undoBtn.connect('clicked', () => {
            this._model.undo();
        });
        this.add_child(this._undoBtn);

        this._redoBtn = new St.Button({
            style_class: 'screenshot-draw-tool-button',
            can_focus: true,
            track_hover: true,
            accessible_name: 'Rehacer (Ctrl+Shift+Z)',
        });
        this._redoBtn.set_child(new St.Icon({
            icon_name: 'edit-redo-symbolic',
            icon_size: 16,
        }));
        this._redoBtn.connect('clicked', () => {
            this._model.redo();
        });
        this.add_child(this._redoBtn);

        const clearBtn = new St.Button({
            style_class: 'screenshot-draw-tool-button',
            can_focus: true,
            track_hover: true,
            accessible_name: 'Limpiar todo (Supr)',
        });
        clearBtn.set_child(new St.Icon({
            icon_name: 'edit-clear-symbolic',
            icon_size: 16,
        }));
        clearBtn.connect('clicked', () => {
            this._model.clear();
        });
        this.add_child(clearBtn);
    }

    get colorPopover() {
        return this._colorPopover;
    }

    get colorButton() {
        return this._colorButton;
    }

    /** Oculta la paleta desplegable, si está abierta. */
    closePopover() {
        if (this._colorPopover) {
            this._colorPopover.visible = false;
        }
    }

    _syncState() {
        for (const [id, btn] of this._toolButtons) {
            btn.set_checked(this._model.activeTool === id);
        }

        if (this._colorPreviewSwatch) {
            this._colorPreviewSwatch.set_style(`background-color: ${this._model.activeColor.hex};`);
        }

        if (this._sizeLabel) {
            this._sizeLabel.set_text(`${this._model.activeWidth}px`);
        }

        if (this._undoBtn) {
            this._undoBtn.reactive = this._model.canUndo();
            this._undoBtn.opacity = this._model.canUndo() ? 255 : 90;
        }

        if (this._redoBtn) {
            this._redoBtn.reactive = this._model.canRedo();
            this._redoBtn.opacity = this._model.canRedo() ? 255 : 90;
        }
    }

    destroy() {
        if (this._colorPopover) {
            this._colorPopover.get_parent()?.remove_child(this._colorPopover);
            this._colorPopover.destroy();
            this._colorPopover = null;
        }
        if (this._model && this._modelListener) {
            this._model.removeListener(this._modelListener);
            this._modelListener = null;
        }
        super.destroy();
    }
});
