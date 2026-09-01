import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { DrawingModel, ToolType } from './core/drawingModel.js';
import { DrawingCanvas } from './ui/drawingCanvas.js';
import { DrawingToolbar } from './ui/drawingToolbar.js';
import { ScreenshotCompositor } from './core/compositor.js';

export class ScreenshotPatcher {
    constructor() {
        this._model = new DrawingModel();
        this._drawToggleButton = null;
        this._toolbar = null;
        this._drawingCanvas = null;
        this._signals = [];
        this._stageKeyId = null;

        this._origOpen = null;
        this._origClose = null;
        this._origSaveScreenshot = null;

        this._lockdownSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.lockdown' });
    }

    enable() {
        const ui = Main.screenshotUI;
        if (!ui) return;

        this._cleanLeftovers(ui);
        this._createUIComponents(ui);
        this._hookMethods(ui);
    }

    disable() {
        const ui = Main.screenshotUI;

        // 1. Desconectar listener global del stage
        if (this._stageKeyId) {
            try {
                global.stage.disconnect(this._stageKeyId);
            } catch (e) {
                // ignorar
            }
            this._stageKeyId = null;
        }

        // 2. Restaurar métodos originales
        if (ui && this._origSaveScreenshot) {
            ui._saveScreenshot = this._origSaveScreenshot;
            this._origSaveScreenshot = null;
        }

        if (ui && this._origOpen) {
            ui.open = this._origOpen;
            this._origOpen = null;
        }

        if (ui && this._origClose) {
            ui.close = this._origClose;
            this._origClose = null;
        }

        // 3. Desconectar señales
        for (const [obj, id] of this._signals) {
            try {
                if (obj && id) obj.disconnect(id);
            } catch (e) {
                // ignorar
            }
        }
        this._signals = [];

        // 4. Destruir componentes visuales
        if (this._drawToggleButton) {
            this._drawToggleButton.destroy();
            this._drawToggleButton = null;
        }

        if (this._toolbar) {
            this._toolbar.destroy();
            this._toolbar = null;
        }

        if (this._drawingCanvas) {
            this._drawingCanvas.destroy();
            this._drawingCanvas = null;
        }

        if (ui) {
            this._cleanLeftovers(ui);
        }
    }

    _cleanLeftovers(ui) {
        try {
            if (ui._panel) {
                for (const child of ui._panel.get_children()) {
                    if (child.has_style_class_name && child.has_style_class_name('screenshot-draw-toolbar')) {
                        ui._panel.remove_child(child);
                        child.destroy();
                    }
                }
            }
            if (ui._primaryMonitorBin) {
                for (const child of ui._primaryMonitorBin.get_children()) {
                    if (child.has_style_class_name && child.has_style_class_name('screenshot-draw-toolbar')) {
                        ui._primaryMonitorBin.remove_child(child);
                        child.destroy();
                    }
                }
            }
        } catch (e) {
            console.error('Error limpiando residuos en ScreenshotUI:', e);
        }
    }

    _setMenuOpacity(opacity) {
        const duration = 200;
        const mode = Clutter.AnimationMode.EASE_OUT_QUAD;

        if (Main.screenshotUI && Main.screenshotUI._panel) {
            Main.screenshotUI._panel.ease({ opacity, duration, mode });
        }
        if (Main.screenshotUI && Main.screenshotUI._closeButton) {
            Main.screenshotUI._closeButton.ease({ opacity, duration, mode });
        }
        if (this._toolbar && this._toolbar.visible) {
            this._toolbar.ease({ opacity, duration, mode });
        }
    }

    _createUIComponents(ui) {
        // --- 1. Canvas de Dibujo sobre el Stage ---
        this._drawingCanvas = new DrawingCanvas(this._model);
        this._drawingCanvas.add_constraint(new Clutter.BindConstraint({
            source: global.stage,
            coordinate: Clutter.BindCoordinate.ALL,
        }));
        this._drawingCanvas.visible = false;
        this._drawingCanvas.reactive = false;

        // Conectar eventos de dibujo para atenuar los menús cuando se dibuja
        const drawStartId = this._drawingCanvas.connect('draw-started', () => {
            this._setMenuOpacity(60);
        });
        const drawEndId = this._drawingCanvas.connect('draw-ended', () => {
            this._setMenuOpacity(255);
        });
        this._signals.push([this._drawingCanvas, drawStartId], [this._drawingCanvas, drawEndId]);

        ui.add_child(this._drawingCanvas);

        // --- 2. Barra de herramientas flotante (Menú de dibujo independiente, ENCIMA del panel) ---
        this._toolbar = new DrawingToolbar(this._model);
        this._toolbar.visible = false;

        // Desplazamiento vertical para flotar libremente arriba del panel
        this._toolbar.translation_y = -22;

        if (ui._panel && ui._primaryMonitorBin) {
            this._toolbar.add_constraint(new Clutter.BindConstraint({
                source: ui._panel,
                coordinate: Clutter.BindCoordinate.POSITION,
            }));
            this._toolbar.add_constraint(new Clutter.AlignConstraint({
                source: ui._panel,
                align_axis: Clutter.AlignAxis.Y_AXIS,
                factor: 0.0,
                pivot_point: new Graphene.Point({ x: -1, y: 1.0 }),
            }));
            this._toolbar.add_constraint(new Clutter.AlignConstraint({
                source: ui._panel,
                align_axis: Clutter.AlignAxis.X_AXIS,
                factor: 0.5,
                pivot_point: new Graphene.Point({ x: 0.5, y: -1 }),
            }));

            ui._primaryMonitorBin.add_child(this._toolbar);
        }

        // --- 3. Botón Toggle "Dibujar" en el panel principal de GNOME ---
        this._drawToggleButton = new St.Button({
            style_class: 'screenshot-ui-type-button',
            can_focus: true,
            toggle_mode: true,
            x_expand: true,
        });

        const btnBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'icon-label-button-container',
        });
        btnBox.add_child(new St.Icon({ icon_name: 'document-edit-symbolic', icon_size: 24 }));
        btnBox.add_child(new St.Label({
            text: _('Dibujar'),
            x_align: Clutter.ActorAlign.CENTER,
        }));
        this._drawToggleButton.set_child(btnBox);

        const toggleId = this._drawToggleButton.connect('notify::checked', () => {
            this._onDrawToggled();
        });
        this._signals.push([this._drawToggleButton, toggleId]);

        if (ui._typeButtonContainer) {
            ui._typeButtonContainer.add_child(this._drawToggleButton);
        }

        // Animación de opacidad al arrastrar selección
        if (ui._areaSelector) {
            const dragStartId = ui._areaSelector.connect('drag-started', () => {
                this._setMenuOpacity(100);
            });
            const dragEndId = ui._areaSelector.connect('drag-ended', () => {
                this._setMenuOpacity(255);
            });
            this._signals.push([ui._areaSelector, dragStartId], [ui._areaSelector, dragEndId]);
        }
    }

    _onDrawToggled() {
        const isDrawingActive = this._drawToggleButton.checked;

        this._toolbar.visible = isDrawingActive;

        if (isDrawingActive) {
            this._drawingCanvas.visible = true;
            this._drawingCanvas.reactive = true;
            if (Main.screenshotUI && this._drawingCanvas.get_parent() === Main.screenshotUI) {
                Main.screenshotUI.set_child_above_sibling(this._drawingCanvas, null);
                if (Main.screenshotUI._primaryMonitorBin) {
                    Main.screenshotUI.set_child_above_sibling(Main.screenshotUI._primaryMonitorBin, this._drawingCanvas);
                }
            }
        } else {
            this._drawingCanvas.reactive = false;
            this._drawingCanvas.visible = this._model.hasStrokes();
        }
    }

    _activateTool(tool) {
        if (this._drawToggleButton && !this._drawToggleButton.checked) {
            this._drawToggleButton.checked = true;
        }
        this._model.setActiveTool(tool);
    }

    _onStageKeyPress(event) {
        if (!Main.screenshotUI || !Main.screenshotUI.visible) {
            return Clutter.EVENT_PROPAGATE;
        }

        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;

        // 1. Ctrl + Z -> Deshacer
        if (isCtrl && (symbol === Clutter.KEY_z || symbol === Clutter.KEY_Z)) {
            this._model.undo();
            return Clutter.EVENT_STOP;
        }

        // 2. Delete / Backspace -> Limpiar todo
        if (symbol === Clutter.KEY_Delete || symbol === Clutter.KEY_BackSpace) {
            if (this._drawToggleButton && this._drawToggleButton.checked) {
                this._model.clear();
                return Clutter.EVENT_STOP;
            }
        }

        // 3. Atajos de herramientas estilo Lightshot
        switch (symbol) {
            case Clutter.KEY_p:
            case Clutter.KEY_P:
            case Clutter.KEY_d:
            case Clutter.KEY_D:
                this._activateTool(ToolType.PEN);
                return Clutter.EVENT_STOP;

            case Clutter.KEY_l:
            case Clutter.KEY_L:
                this._activateTool(ToolType.LINE);
                return Clutter.EVENT_STOP;

            case Clutter.KEY_a:
            case Clutter.KEY_A:
                this._activateTool(ToolType.ARROW);
                return Clutter.EVENT_STOP;

            case Clutter.KEY_r:
            case Clutter.KEY_R:
                this._activateTool(ToolType.RECT);
                return Clutter.EVENT_STOP;

            case Clutter.KEY_h:
            case Clutter.KEY_H:
                this._activateTool(ToolType.HIGHLIGHTER);
                return Clutter.EVENT_STOP;

            case Clutter.KEY_t:
            case Clutter.KEY_T:
                this._activateTool(ToolType.TEXT);
                return Clutter.EVENT_STOP;

            case Clutter.KEY_c:
            case Clutter.KEY_C:
                this._model.cycleColor();
                return Clutter.EVENT_STOP;

            case Clutter.KEY_plus:
            case Clutter.KEY_equal:
            case Clutter.KEY_KP_Add:
                this._model.increaseSize();
                return Clutter.EVENT_STOP;

            case Clutter.KEY_minus:
            case Clutter.KEY_underscore:
            case Clutter.KEY_KP_Subtract:
                this._model.decreaseSize();
                return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _hookMethods(ui) {
        const self = this;

        this._origOpen = ui.open;
        ui.open = async function(mode) {
            self._model.clear();
            if (self._drawToggleButton) {
                self._drawToggleButton.checked = false;
            }
            if (self._toolbar) {
                self._toolbar.visible = false;
            }
            if (self._drawingCanvas) {
                self._drawingCanvas.visible = false;
                self._drawingCanvas.reactive = false;
            }

            if (!self._stageKeyId) {
                self._stageKeyId = global.stage.connect('key-press-event', (actor, event) =>
                    self._onStageKeyPress(event));
            }

            return self._origOpen.call(this, mode);
        };

        this._origClose = ui.close;
        ui.close = function() {
            if (self._stageKeyId) {
                try {
                    global.stage.disconnect(self._stageKeyId);
                } catch (e) {
                    // ignorar
                }
                self._stageKeyId = null;
            }
            return self._origClose.call(this);
        };

        this._origSaveScreenshot = ui._saveScreenshot;
        ui._saveScreenshot = async function() {
            if (!self._model.hasStrokes()) {
                return self._origSaveScreenshot.call(this);
            }

            let file = null;

            try {
                if (this._selectionButton.checked || this._screenButton.checked) {
                    const content = this._stageScreenshot.get_content();
                    if (!content) return;

                    const texture = content.get_texture();
                    const geometry = this._getSelectedGeometry(true);

                    let cursorTexture = this._cursor.content?.get_texture();
                    if (!this._cursor.visible) {
                        cursorTexture = null;
                    }

                    const [x, y, w, h] = geometry ?? [0, 0, -1, -1];
                    const stream = Gio.MemoryOutputStream.new_resizable();

                    global.display.get_sound_player().play_from_theme(
                        'screen-capture', _('Screenshot taken'), null);

                    const rawPixbuf = await Shell.Screenshot.composite_to_stream(
                        texture,
                        x, y, w, h,
                        this._scale,
                        cursorTexture ?? null,
                        this._cursor.x * this._scale,
                        this._cursor.y * this._scale,
                        this._cursorScale,
                        stream
                    );
                    stream.close(null);

                    const { bytes, pixbuf } = ScreenshotCompositor.composite(
                        rawPixbuf,
                        self._model,
                        geometry,
                        this._scale
                    );

                    file = self._storeScreenshot(bytes, pixbuf);
                } else if (this._windowButton.checked) {
                    const window = this._windowSelectors
                        .flatMap(selector => selector.windows())
                        .find(win => win.checked);

                    if (!window) return;

                    const content = window.windowContent;
                    if (!content) return;

                    const texture = content.get_texture();
                    let cursorTexture = window.getCursorTexture()?.get_texture();
                    if (!this._cursor.visible) {
                        cursorTexture = null;
                    }

                    const stream = Gio.MemoryOutputStream.new_resizable();

                    global.display.get_sound_player().play_from_theme(
                        'screen-capture', _('Screenshot taken'), null);

                    const rawPixbuf = await Shell.Screenshot.composite_to_stream(
                        texture,
                        0, 0, -1, -1,
                        window.bufferScale,
                        cursorTexture ?? null,
                        window.cursorPoint.x * window.bufferScale,
                        window.cursorPoint.y * window.bufferScale,
                        this._cursorScale,
                        stream
                    );
                    stream.close(null);

                    const { bytes, pixbuf } = ScreenshotCompositor.composite(
                        rawPixbuf,
                        self._model,
                        null,
                        window.bufferScale
                    );

                    file = self._storeScreenshot(bytes, pixbuf);
                }
            } catch (e) {
                console.error('Error al guardar captura con anotaciones:', e);
            }

            if (file) {
                this.emit('screenshot-taken', file);
            }
        };
    }

    _storeScreenshot(bytes, pixbuf) {
        const clipboard = St.Clipboard.get_default();
        clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', bytes);

        const time = GLib.DateTime.new_now_local();
        let file = null;

        const disableSaveToDisk = this._lockdownSettings.get_boolean('disable-save-to-disk');

        if (!disableSaveToDisk) {
            const dir = Gio.File.new_for_path(GLib.build_filenamev([
                GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) || GLib.get_home_dir(),
                _('Screenshots'),
            ]));

            try {
                dir.make_directory_with_parents(null);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
                    console.error('Error al crear directorio de capturas:', e);
                }
            }

            const timestamp = time.format('%Y-%m-%d %H-%M-%S');
            const name = _('Screenshot From %s').format(timestamp);

            for (let i = 0; ; i++) {
                const suffix = i === 0 ? '' : `-${i}`;
                file = Gio.File.new_for_path(GLib.build_filenamev([
                    dir.get_path(), `${name}${suffix}.png`,
                ]));

                try {
                    const stream = file.create(Gio.FileCreateFlags.NONE, null);
                    stream.write_bytes(bytes, null);
                    stream.close(null);
                    break;
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
                        console.error('Error al escribir archivo de captura:', e);
                        break;
                    }
                }
            }
        }

        try {
            const coglContext = global.stage.context.get_backend().get_cogl_context();
            const pixels = pixbuf.read_pixel_bytes();
            const content = St.ImageContent.new_with_preferred_size(pixbuf.width, pixbuf.height);
            content.set_bytes(
                coglContext,
                pixels,
                Cogl.PixelFormat.RGBA_8888,
                pixbuf.width,
                pixbuf.height,
                pixbuf.rowstride
            );

            const source = new MessageTray.Source({
                title: _('Screen Capture'),
                iconName: 'screenshooter-symbolic',
            });
            Main.messageTray.add(source);

            const notification = new MessageTray.Notification({
                source,
                title: _('Screenshot captured'),
                body: _('You can paste the image from the clipboard'),
                datetime: time,
                gicon: content,
                isTransient: true,
            });

            if (file) {
                notification.addAction(_('Show in Files'), () => {
                    const app = Gio.app_info_get_default_for_type('inode/directory', false);
                    if (app) {
                        app.launch([file], global.create_app_launch_context(0, -1));
                    }
                });
                notification.connect('activated', () => {
                    try {
                        Gio.app_info_launch_default_for_uri(file.get_uri(), global.create_app_launch_context(0, -1));
                    } catch (err) {
                        console.error('Error opening screenshot:', err);
                    }
                });
            }

            source.addNotification(notification);
        } catch (e) {
            console.error('Error al mostrar notificación de captura:', e);
        }

        return file;
    }
}
