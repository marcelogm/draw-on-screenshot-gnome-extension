import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { ScreenshotPatcher } from './src/patcher.js';

export default class DrawOnScreenshotExtension extends Extension {
    enable() {
        this._patcher = new ScreenshotPatcher();
        this._patcher.enable();
    }

    disable() {
        if (this._patcher) {
            this._patcher.disable();
            this._patcher = null;
        }
    }
}
