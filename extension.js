import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { ScreenshotPatcher } from './src/patcher.js';
import { logWarning } from './src/core/log.js';

export default class DrawOnScreenshotExtension extends Extension {
    enable() {
        const iconsPath = GLib.build_filenamev([this.path, 'icons']);

        // Sin el esquema compilado la extensión sigue siendo utilizable con sus
        // valores por defecto; sólo se pierde la configuración.
        let settings = null;
        try {
            settings = this.getSettings();
        } catch (e) {
            logWarning('No se pudo abrir el esquema de preferencias; ' +
                       'se usarán los valores por defecto.');
        }

        this._patcher = new ScreenshotPatcher(iconsPath, settings);
        this._patcher.enable();
    }

    disable() {
        if (this._patcher) {
            this._patcher.disable();
            this._patcher = null;
        }
    }
}
