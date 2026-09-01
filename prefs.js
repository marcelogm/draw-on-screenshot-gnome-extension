import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Marcador para xgettext: las cadenas de las tablas se dejan sin traducir y las
 * traduce `_()` al construir cada fila.
 */
const N_ = str => str;

/**
 * Herramientas en su orden canónico. Debe coincidir con `ToolOrder` de
 * `src/core/drawingModel.js`; los identificadores son los que guarda
 * `enabled-tools` y los que lee la barra.
 */
const TOOLS = [
    { id: 'pen', title: N_('Pen'), subtitle: N_('Freehand drawing') },
    { id: 'line', title: N_('Line'), subtitle: N_('Straight line, Shift snaps to 45°') },
    { id: 'arrow', title: N_('Arrow'), subtitle: N_('Arrow head at the release point') },
    { id: 'rect', title: N_('Rectangle'), subtitle: N_('Shift for a square, Ctrl from the centre') },
    { id: 'ellipse', title: N_('Ellipse'), subtitle: N_('Shift for a circle, Ctrl from the centre') },
    { id: 'highlighter', title: N_('Highlighter'), subtitle: N_('Wide translucent stroke') },
    { id: 'text', title: N_('Text'), subtitle: N_('Click, type and press Enter') },
    { id: 'counter', title: N_('Counter'), subtitle: N_('Numbered bubbles that count up on their own') },
    { id: 'pixelate', title: N_('Pixelate'), subtitle: N_('Hide a region of the capture') },
];

/** Secciones de la barra que no son herramientas de dibujo. */
const SECTIONS = [
    { key: 'show-color-picker', title: N_('Colour picker'), subtitle: N_('Swatch button and palette popover') },
    { key: 'show-fill-toggle', title: N_('Fill toggle'), subtitle: N_('Switch shapes between outlined and filled') },
    { key: 'show-size-stepper', title: N_('Stroke width'), subtitle: N_('The − / + buttons and the current width') },
    { key: 'show-undo-redo', title: N_('Undo and redo'), subtitle: null },
    { key: 'show-clear', title: N_('Clear all'), subtitle: null },
    { key: 'show-tooltips', title: N_('Tooltips'), subtitle: N_('Explain each button when the pointer rests on it') },
];

const SHORTCUTS = [
    { key: 'key-tool-pen', title: N_('Pen') },
    { key: 'key-tool-line', title: N_('Line') },
    { key: 'key-tool-arrow', title: N_('Arrow') },
    { key: 'key-tool-rect', title: N_('Rectangle') },
    { key: 'key-tool-ellipse', title: N_('Ellipse') },
    { key: 'key-tool-highlighter', title: N_('Highlighter') },
    { key: 'key-tool-text', title: N_('Text') },
    { key: 'key-tool-counter', title: N_('Counter') },
    { key: 'key-tool-pixelate', title: N_('Pixelate') },
];

const ACTION_SHORTCUTS = [
    { key: 'key-undo', title: N_('Undo') },
    { key: 'key-redo', title: N_('Redo') },
    { key: 'key-clear', title: N_('Clear all') },
    { key: 'key-cycle-color', title: N_('Next colour') },
    { key: 'key-increase-size', title: N_('Thicker stroke') },
    { key: 'key-decrease-size', title: N_('Thinner stroke') },
    { key: 'key-toggle-fill', title: N_('Toggle fill') },
];

/** Teclas que por sí solas no forman un atajo. */
const LONE_MODIFIERS = new Set([
    Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
    Gdk.KEY_Control_L, Gdk.KEY_Control_R,
    Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
    Gdk.KEY_Super_L, Gdk.KEY_Super_R,
    Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
    Gdk.KEY_Caps_Lock, Gdk.KEY_ISO_Level3_Shift,
]);

function hexToRgba(hex) {
    const rgba = new Gdk.RGBA();
    if (!rgba.parse(hex)) rgba.parse('#000000');
    return rgba;
}

function rgbaToHex(rgba) {
    const byte = value => Math.round(Math.max(0, Math.min(1, value)) * 255)
        .toString(16)
        .padStart(2, '0');
    return `#${byte(rgba.red)}${byte(rgba.green)}${byte(rgba.blue)}`;
}

export default class DrawOnScreenshotPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.add(this._buildToolbarPage(settings));
        window.add(this._buildDrawingPage(settings));
        window.add(this._buildShortcutsPage(window, settings));

        window.set_default_size(620, 740);
    }

    // =====================================================================
    // Página 1 — qué aparece en la barra
    // =====================================================================

    _buildToolbarPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Toolbar'),
            icon_name: 'view-more-horizontal-symbolic',
        });

        const toolsGroup = new Adw.PreferencesGroup({
            title: _('Tools'),
            description: _('Turn a tool off to keep it out of the toolbar. ' +
                'The arrows set the order the buttons appear in.'),
        });
        page.add(toolsGroup);

        this._buildToolRows(toolsGroup, settings);

        const sectionsGroup = new Adw.PreferencesGroup({
            title: _('Controls'),
            description: _('The rest of the toolbar. Hidden controls keep working ' +
                'through their keyboard shortcuts.'),
        });
        page.add(sectionsGroup);

        for (const section of SECTIONS) {
            const row = new Adw.SwitchRow({
                title: _(section.title),
                subtitle: section.subtitle ? _(section.subtitle) : null,
            });
            settings.bind(section.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            sectionsGroup.add(row);
        }

        return page;
    }

    /**
     * Las filas de herramientas se reconstruyen enteras en cada cambio.
     * `enabled-tools` codifica a la vez presencia y orden, así que mantener los
     * widgets vivos y moverlos uno a uno sería más frágil que redibujar una
     * lista que como mucho tiene nueve elementos.
     */
    _buildToolRows(group, settings) {
        const rows = [];

        const render = () => {
            for (const row of rows.splice(0)) {
                group.remove(row);
            }

            const enabled = settings.get_strv('enabled-tools')
                .filter(id => TOOLS.some(t => t.id === id));
            const disabled = TOOLS.map(t => t.id).filter(id => !enabled.includes(id));

            // Primero las activas en su orden guardado; después las apagadas,
            // que no tienen posición propia hasta que se encienden.
            const order = [...enabled, ...disabled];

            order.forEach((id, index) => {
                const tool = TOOLS.find(t => t.id === id);
                const isEnabled = enabled.includes(id);
                const position = enabled.indexOf(id);

                const row = new Adw.ActionRow({
                    title: _(tool.title),
                    subtitle: _(tool.subtitle),
                });

                const up = new Gtk.Button({
                    icon_name: 'go-up-symbolic',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: _('Move left in the toolbar'),
                    sensitive: isEnabled && position > 0,
                });
                up.add_css_class('flat');
                up.connect('clicked', () => {
                    const list = settings.get_strv('enabled-tools');
                    const i = list.indexOf(id);
                    if (i > 0) {
                        [list[i - 1], list[i]] = [list[i], list[i - 1]];
                        settings.set_strv('enabled-tools', list);
                    }
                });

                const down = new Gtk.Button({
                    icon_name: 'go-down-symbolic',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: _('Move right in the toolbar'),
                    sensitive: isEnabled && position >= 0 && position < enabled.length - 1,
                });
                down.add_css_class('flat');
                down.connect('clicked', () => {
                    const list = settings.get_strv('enabled-tools');
                    const i = list.indexOf(id);
                    if (i >= 0 && i < list.length - 1) {
                        [list[i + 1], list[i]] = [list[i], list[i + 1]];
                        settings.set_strv('enabled-tools', list);
                    }
                });

                const toggle = new Gtk.Switch({
                    active: isEnabled,
                    valign: Gtk.Align.CENTER,
                });
                toggle.connect('notify::active', () => {
                    const list = settings.get_strv('enabled-tools');
                    const i = list.indexOf(id);
                    if (toggle.active && i < 0) {
                        list.push(id);
                    } else if (!toggle.active && i >= 0) {
                        list.splice(i, 1);
                    } else {
                        return;
                    }
                    settings.set_strv('enabled-tools', list);
                });

                row.add_suffix(up);
                row.add_suffix(down);
                row.add_suffix(toggle);
                row.activatable_widget = toggle;

                group.add(row);
                rows.push(row);
            });
        };

        render();

        // El redibujado se aplaza al bucle ocioso: quien lo dispara suele ser el
        // propio widget que la nueva pasada destruiría, y destruirlo dentro de
        // su manejador de señal es pedir problemas.
        const changedId = settings.connect('changed::enabled-tools', () =>
            this._defer(group, render));
        group.connect('destroy', () => settings.disconnect(changedId));
    }

    // =====================================================================
    // Página 2 — cómo se dibuja
    // =====================================================================

    _buildDrawingPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Drawing'),
            icon_name: 'applications-graphics-symbolic',
        });

        // --- Paleta ---
        const paletteGroup = new Adw.PreferencesGroup({
            title: _('Palette'),
            description: _('Colours offered by the picker, in order. ' +
                'The first one is selected when the capture UI opens.'),
        });
        page.add(paletteGroup);

        const paletteButtons = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
        });

        const addBtn = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            tooltip_text: _('Add a colour'),
            valign: Gtk.Align.CENTER,
        });
        addBtn.add_css_class('flat');
        addBtn.connect('clicked', () => {
            const list = settings.get_strv('palette');
            list.push('#ffffff');
            settings.set_strv('palette', list);
        });

        const resetBtn = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: _('Restore the default palette'),
            valign: Gtk.Align.CENTER,
        });
        resetBtn.add_css_class('flat');
        resetBtn.connect('clicked', () => settings.reset('palette'));

        paletteButtons.append(resetBtn);
        paletteButtons.append(addBtn);
        paletteGroup.set_header_suffix(paletteButtons);

        this._buildPaletteRows(paletteGroup, settings);

        // --- Trazo ---
        const strokeGroup = new Adw.PreferencesGroup({ title: _('Stroke') });
        page.add(strokeGroup);

        const widthRow = new Adw.SpinRow({
            title: _('Default width'),
            subtitle: _('In pixels. Ctrl + scroll wheel changes it while drawing.'),
            adjustment: new Gtk.Adjustment({
                lower: 2, upper: 48, step_increment: 1, page_increment: 4,
            }),
        });
        settings.bind('default-width', widthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        strokeGroup.add(widthRow);

        const fillRow = new Adw.SwitchRow({
            title: _('Fill shapes by default'),
            subtitle: _('Rectangles and ellipses start filled instead of outlined'),
        });
        settings.bind('fill-shapes', fillRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        strokeGroup.add(fillRow);

        const shadowRow = new Adw.SwitchRow({
            title: _('Shadow under annotations'),
            subtitle: _('Keeps them legible over both light and dark backgrounds'),
        });
        settings.bind('stroke-shadow', shadowRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        strokeGroup.add(shadowRow);

        // --- Texto ---
        const textGroup = new Adw.PreferencesGroup({ title: _('Text') });
        page.add(textGroup);

        const boldRow = new Adw.SwitchRow({
            title: _('Bold text'),
            subtitle: _('Off by default: text is drawn at normal weight'),
        });
        settings.bind('text-bold', boldRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        textGroup.add(boldRow);

        const fontRow = new Adw.EntryRow({ title: _('Font family') });
        settings.bind('font-family', fontRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        textGroup.add(fontRow);

        // --- Contador y pixelado ---
        const extrasGroup = new Adw.PreferencesGroup({ title: _('Counter and pixelate') });
        page.add(extrasGroup);

        const counterRow = new Adw.SpinRow({
            title: _('First counter number'),
            subtitle: _('Each capture starts the sequence again from this value'),
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 999, step_increment: 1, page_increment: 10,
            }),
        });
        settings.bind('counter-start', counterRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        extrasGroup.add(counterRow);

        const blockRow = new Adw.SpinRow({
            title: _('Pixelation block size'),
            subtitle: _('Larger blocks hide more. Applied when the capture is saved.'),
            adjustment: new Gtk.Adjustment({
                lower: 4, upper: 64, step_increment: 1, page_increment: 4,
            }),
        });
        settings.bind('pixelate-block', blockRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        extrasGroup.add(blockRow);

        return page;
    }

    _buildPaletteRows(group, settings) {
        const rows = [];

        const render = () => {
            for (const row of rows.splice(0)) {
                group.remove(row);
            }

            const palette = settings.get_strv('palette');

            palette.forEach((hex, index) => {
                const row = new Adw.ActionRow({
                    title: hex.toUpperCase(),
                    subtitle: index === 0 ? _('Default colour') : null,
                });

                const colorBtn = new Gtk.ColorDialogButton({
                    dialog: new Gtk.ColorDialog({ with_alpha: false }),
                    rgba: hexToRgba(hex),
                    valign: Gtk.Align.CENTER,
                });
                colorBtn.connect('notify::rgba', () => {
                    const list = settings.get_strv('palette');
                    const next = rgbaToHex(colorBtn.get_rgba());
                    if (list[index] === next) return;
                    list[index] = next;
                    settings.set_strv('palette', list);
                });

                const up = new Gtk.Button({
                    icon_name: 'go-up-symbolic',
                    valign: Gtk.Align.CENTER,
                    sensitive: index > 0,
                    tooltip_text: _('Move up'),
                });
                up.add_css_class('flat');
                up.connect('clicked', () => {
                    const list = settings.get_strv('palette');
                    [list[index - 1], list[index]] = [list[index], list[index - 1]];
                    settings.set_strv('palette', list);
                });

                const down = new Gtk.Button({
                    icon_name: 'go-down-symbolic',
                    valign: Gtk.Align.CENTER,
                    sensitive: index < palette.length - 1,
                    tooltip_text: _('Move down'),
                });
                down.add_css_class('flat');
                down.connect('clicked', () => {
                    const list = settings.get_strv('palette');
                    [list[index + 1], list[index]] = [list[index], list[index + 1]];
                    settings.set_strv('palette', list);
                });

                // La paleta no puede quedarse vacía: sin colores no habría con
                // qué dibujar y el modelo tendría que inventarse uno.
                const remove = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    sensitive: palette.length > 1,
                    tooltip_text: _('Remove this colour'),
                });
                remove.add_css_class('flat');
                remove.connect('clicked', () => {
                    const list = settings.get_strv('palette');
                    list.splice(index, 1);
                    settings.set_strv('palette', list);
                });

                row.add_suffix(colorBtn);
                row.add_suffix(up);
                row.add_suffix(down);
                row.add_suffix(remove);
                row.activatable_widget = colorBtn;

                group.add(row);
                rows.push(row);
            });
        };

        render();

        const changedId = settings.connect('changed::palette', () =>
            this._defer(group, render));
        group.connect('destroy', () => settings.disconnect(changedId));
    }

    /**
     * Ejecuta `callback` en el siguiente ciclo ocioso, como mucho una vez por
     * ciclo, y sólo si el widget sigue vivo.
     */
    _defer(widget, callback) {
        if (widget._deferredId) return;
        widget._deferredId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            widget._deferredId = 0;
            if (widget.get_root() !== null || widget.get_parent() !== null) {
                callback();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // =====================================================================
    // Página 3 — atajos
    // =====================================================================

    _buildShortcutsPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _('Shortcuts'),
            icon_name: 'preferences-desktop-keyboard-symbolic',
        });

        const toolsGroup = new Adw.PreferencesGroup({
            title: _('Tools'),
            description: _('These only apply while the screenshot UI is open. ' +
                'Single letters are fine; they are ignored while you type an annotation.'),
        });
        page.add(toolsGroup);

        for (const item of SHORTCUTS) {
            toolsGroup.add(this._makeShortcutRow(window, settings, item));
        }

        const actionsGroup = new Adw.PreferencesGroup({ title: _('Actions') });
        page.add(actionsGroup);

        for (const item of ACTION_SHORTCUTS) {
            actionsGroup.add(this._makeShortcutRow(window, settings, item));
        }

        const resetGroup = new Adw.PreferencesGroup();
        page.add(resetGroup);

        const resetRow = new Adw.ActionRow({
            title: _('Reset all shortcuts'),
            subtitle: _('Restore the shortcuts this extension ships with'),
        });
        const resetBtn = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
        });
        resetBtn.connect('clicked', () => {
            for (const item of [...SHORTCUTS, ...ACTION_SHORTCUTS]) {
                settings.reset(item.key);
            }
        });
        resetRow.add_suffix(resetBtn);
        resetGroup.add(resetRow);

        return page;
    }

    _makeShortcutRow(window, settings, item) {
        const row = new Adw.ActionRow({
            title: _(item.title),
            activatable: true,
        });

        const label = new Gtk.ShortcutLabel({
            valign: Gtk.Align.CENTER,
            disabled_text: _('Disabled'),
            accelerator: settings.get_string(item.key),
        });

        const clear = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Disable this shortcut'),
        });
        clear.add_css_class('flat');
        clear.connect('clicked', () => settings.set_string(item.key, ''));

        row.add_suffix(label);
        row.add_suffix(clear);

        const changedId = settings.connect(`changed::${item.key}`, () => {
            label.set_accelerator(settings.get_string(item.key));
        });
        row.connect('destroy', () => settings.disconnect(changedId));

        row.connect('activated', () => this._captureShortcut(window, settings, item));

        return row;
    }

    /**
     * Diálogo de captura de tecla.
     *
     * Se toma el control del teclado mientras está abierto para que el atajo que
     * el usuario pulsa no lo interprete la propia ventana de preferencias.
     */
    _captureShortcut(window, settings, item) {
        const dialog = new Adw.AlertDialog({
            heading: `${_('Set shortcut')}: ${_(item.title)}`,
            body: _('Press the key combination you want to use.\n' +
                'Backspace disables the shortcut, Escape keeps the current one.'),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.set_close_response('cancel');

        const controller = new Gtk.EventControllerKey();
        controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        dialog.add_controller(controller);

        controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
            if (LONE_MODIFIERS.has(keyval)) return Gdk.EVENT_STOP;

            let mask = state & Gtk.accelerator_get_default_mod_mask();
            mask &= ~Gdk.ModifierType.LOCK_MASK;

            if (keyval === Gdk.KEY_Escape && mask === 0) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            if (keyval === Gdk.KEY_BackSpace && mask === 0) {
                settings.set_string(item.key, '');
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            // Con Mayús, GDK entrega la letra ya en mayúscula. Se normaliza para
            // que `<Control><Shift>z` y `<Control><Shift>Z` no sean dos atajos.
            const lower = Gdk.keyval_to_lower(keyval);
            const accel = Gtk.accelerator_name(lower, mask);
            if (accel && accel.length > 0) {
                settings.set_string(item.key, accel);
            }
            dialog.close();
            return Gdk.EVENT_STOP;
        });

        dialog.present(window);
    }
}
