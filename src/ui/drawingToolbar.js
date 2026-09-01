import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import { ToolType, ColorPalette } from '../core/drawingModel.js';

export const DrawingToolbar = GObject.registerClass(
class DrawingToolbar extends St.BoxLayout {
    _init(model, params = {}) {
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
        this._toolButtons = new Map();
        this._colorPopover = null;
        this._colorPreviewSwatch = null;
        this._sizeLabel = null;

        this._buildUI();

        this._modelListener = () => this._syncState();
        this._model.addListener(this._modelListener);
        this._syncState();
    }

    _createSeparator() {
        return new St.Widget({
            style_class: 'screenshot-draw-separator',
        });
    }

    _buildUI() {
        // --- 1. Herramientas Lightshot con Iconos Exactos ---
        const tools = [
            { id: ToolType.PEN, icon: 'document-edit-symbolic', tooltip: 'Lápiz (P / D)' },
            { id: ToolType.LINE, icon: 'format-text-direction-ltr-symbolic', tooltip: 'Línea (L)' },
            { id: ToolType.ARROW, icon: 'go-next-symbolic', tooltip: 'Flecha (A)' },
            { id: ToolType.RECT, icon: 'media-playback-stop-symbolic', tooltip: 'Rectángulo (R)' }, // Cuadrado limpio
            { id: ToolType.HIGHLIGHTER, icon: 'format-text-bold-symbolic', tooltip: 'Resaltador (H)' }, // Marcador limpio
            { id: ToolType.TEXT, icon: 'insert-text-symbolic', tooltip: 'Texto (T)' },
        ];

        for (const tool of tools) {
            const btn = new St.Button({
                style_class: 'screenshot-draw-tool-button',
                can_focus: true,
                track_hover: true,
                accessible_name: tool.tooltip,
            });

            btn.set_child(new St.Icon({
                icon_name: tool.icon,
                icon_size: 16,
            }));

            btn.connect('clicked', () => {
                this._model.setActiveTool(tool.id);
            });

            this.add_child(btn);
            this._toolButtons.set(tool.id, btn);
        }

        this.add_child(this._createSeparator());

        // --- 2. Selector de Color Único con Popover / Colorpicker ---
        const colorPickerContainer = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });

        const colorBtn = new St.Button({
            style_class: 'screenshot-draw-color-picker-btn',
            can_focus: true,
            track_hover: true,
            accessible_name: 'Elegir Color (C)',
        });

        this._colorPreviewSwatch = new St.Widget({
            style_class: 'screenshot-draw-color-swatch',
        });
        colorBtn.set_child(this._colorPreviewSwatch);

        // Popover con la paleta de colores flotante
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
        });

        colorPickerContainer.add_child(colorBtn);
        colorPickerContainer.add_child(this._colorPopover);
        this.add_child(colorPickerContainer);

        this.add_child(this._createSeparator());

        // --- 3. Controlador de Tamaño (Subir / Bajar con Botones y Scroll) ---
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

        // Soporte de rueda del mouse sobre el control de tamaño
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

        // --- 4. Acciones: Deshacer (Ctrl+Z) y Limpiar ---
        const undoBtn = new St.Button({
            style_class: 'screenshot-draw-tool-button',
            can_focus: true,
            track_hover: true,
            accessible_name: 'Deshacer (Ctrl+Z)',
        });
        undoBtn.set_child(new St.Icon({
            icon_name: 'edit-undo-symbolic',
            icon_size: 16,
        }));
        undoBtn.connect('clicked', () => {
            this._model.undo();
        });
        this.add_child(undoBtn);

        const clearBtn = new St.Button({
            style_class: 'screenshot-draw-tool-button',
            can_focus: true,
            track_hover: true,
            accessible_name: 'Limpiar Todo (Supr)',
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
    }

    destroy() {
        if (this._model && this._modelListener) {
            this._model.removeListener(this._modelListener);
            this._modelListener = null;
        }
        super.destroy();
    }
});
