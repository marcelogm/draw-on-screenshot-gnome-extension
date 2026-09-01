import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** Retardo antes de mostrar el rótulo, en ms. Igual al de los botones de GTK. */
const SHOW_DELAY = 450;

/** Separación entre el botón y el rótulo, en px lógicos. */
const GAP = 8;

/**
 * Rótulos emergentes para los botones de la barra.
 *
 * St no trae tooltips: los del panel de GNOME los implementa cada widget por su
 * cuenta. Aquí se centraliza uno solo, reutilizado por todos los botones, para
 * no crear un actor por control ni duplicar la lógica de temporizador.
 *
 * El rótulo se cuelga del contenedor que se le indique (el propio ScreenshotUI),
 * no de la barra: así no la ensancha ni queda recortado por ella.
 */
export class TooltipManager {
    constructor() {
        this._label = null;
        this._container = null;
        this._timeoutId = null;
        this._targets = [];
        this._enabled = true;
    }

    /** @param {Clutter.Actor} container Actor del que colgará el rótulo. */
    setContainer(container) {
        this._container = container;
        if (this._label && this._label.get_parent() !== container) {
            this._label.get_parent()?.remove_child(this._label);
            container?.add_child(this._label);
        }
    }

    setEnabled(enabled) {
        this._enabled = enabled;
        if (!enabled) this.hide();
    }

    /**
     * Asocia un rótulo a un actor con `track_hover`.
     *
     * @param {St.Widget} actor
     * @param {string} text
     */
    attach(actor, text) {
        if (!actor || !text) return;

        const hoverId = actor.connect('notify::hover', () => {
            if (actor.hover) {
                this._scheduleShow(actor, text);
            } else {
                this.hide();
            }
        });

        // Al pulsar, el rótulo estorba: la acción ya está hecha y el puntero
        // sigue encima, así que sin esto se quedaría colgando sobre el resultado.
        const clickId = actor.connect('button-press-event', () => {
            this.hide();
            return Clutter.EVENT_PROPAGATE;
        });

        const destroyId = actor.connect('destroy', () => this.hide());

        this._targets.push([actor, hoverId], [actor, clickId], [actor, destroyId]);
    }

    _scheduleShow(actor, text) {
        this._cancelTimeout();
        if (!this._enabled) return;

        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SHOW_DELAY, () => {
            this._timeoutId = null;
            if (actor.hover && actor.mapped) {
                this._show(actor, text);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _show(actor, text) {
        if (!this._container) return;

        if (!this._label) {
            this._label = new St.Label({
                style_class: 'screenshot-draw-tooltip',
                visible: false,
            });
            this._container.add_child(this._label);
        }

        this._label.set_text(text);
        this._label.visible = true;
        this._label.opacity = 0;

        const [actorX, actorY] = actor.get_transformed_position();
        if (!Number.isFinite(actorX) || !Number.isFinite(actorY)) {
            this._label.visible = false;
            return;
        }

        const [, width] = this._label.get_preferred_width(-1);
        const [, height] = this._label.get_preferred_height(-1);
        const monitor = this._monitorAt(actorX, actorY);

        let x = actorX + actor.width / 2 - width / 2;
        x = Math.max(monitor.x + GAP,
            Math.min(x, monitor.x + monitor.width - width - GAP));

        // Encima del botón por defecto: debajo está el panel nativo de captura.
        let y = actorY - height - GAP;
        if (y < monitor.y + GAP) {
            y = actorY + actor.height + GAP;
        }

        this._label.set_position(Math.round(x), Math.round(y));
        this._container.set_child_above_sibling(this._label, null);
        this._label.ease({
            opacity: 255,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _monitorAt(x, y) {
        const monitors = Main.layoutManager.monitors ?? [];
        return monitors.find(m =>
            x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height)
            ?? Main.layoutManager.primaryMonitor
            ?? monitors[0]
            ?? { x: 0, y: 0, width: global.stage.width, height: global.stage.height };
    }

    hide() {
        this._cancelTimeout();
        if (this._label) {
            this._label.remove_all_transitions();
            this._label.visible = false;
        }
    }

    _cancelTimeout() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    destroy() {
        this._cancelTimeout();

        for (const [actor, id] of this._targets) {
            try {
                actor.disconnect(id);
            } catch (e) {
                // El actor pudo destruirse antes; nada que desconectar.
            }
        }
        this._targets = [];

        if (this._label) {
            this._label.get_parent()?.remove_child(this._label);
            this._label.destroy();
            this._label = null;
        }
        this._container = null;
    }
}
