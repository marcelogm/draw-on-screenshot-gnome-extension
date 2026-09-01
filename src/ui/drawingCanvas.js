import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import cairo from 'gi://cairo';
import { ToolType } from '../core/drawingModel.js';

/**
 * Renderiza un trazo específico sobre un contexto de Cairo.
 * Esta función es pura y se reutiliza tanto en la UI en vivo como en el Compositor final.
 */
export function renderStroke(cr, stroke, scale = 1.0, offsetX = 0, offsetY = 0) {
    if (!stroke) return;

    const { color, width, tool, points, start, end, text, fontSize, x, y } = stroke;
    const scaledWidth = width * scale;

    cr.save();
    try {
        cr.setSourceRGBA(color.r, color.g, color.b, color.a ?? 1.0);
        cr.setLineWidth(scaledWidth);
        cr.setLineCap(cairo.LineCap.ROUND);
        cr.setLineJoin(cairo.LineJoin.ROUND);

        if (tool === ToolType.PEN || tool === ToolType.HIGHLIGHTER) {
            if (!points || points.length === 0) return;

            if (points.length === 1) {
                const p = points[0];
                cr.arc((p.x - offsetX) * scale, (p.y - offsetY) * scale, scaledWidth / 2, 0, 2 * Math.PI);
                cr.fill();
            } else {
                cr.moveTo((points[0].x - offsetX) * scale, (points[0].y - offsetY) * scale);
                for (let i = 1; i < points.length; i++) {
                    const p = points[i];
                    cr.lineTo((p.x - offsetX) * scale, (p.y - offsetY) * scale);
                }
                cr.stroke();
            }
        } else if (tool === ToolType.LINE) {
            if (!start || !end) return;

            const sx = (start.x - offsetX) * scale;
            const sy = (start.y - offsetY) * scale;
            const ex = (end.x - offsetX) * scale;
            const ey = (end.y - offsetY) * scale;

            cr.moveTo(sx, sy);
            cr.lineTo(ex, ey);
            cr.stroke();
        } else if (tool === ToolType.RECT) {
            if (!start || !end) return;

            const rx = (Math.min(start.x, end.x) - offsetX) * scale;
            const ry = (Math.min(start.y, end.y) - offsetY) * scale;
            const rw = Math.abs(end.x - start.x) * scale;
            const rh = Math.abs(end.y - start.y) * scale;

            cr.rectangle(rx, ry, rw, rh);
            cr.stroke();
        } else if (tool === ToolType.ARROW) {
            if (!start || !end) return;

            const sx = (start.x - offsetX) * scale;
            const sy = (start.y - offsetY) * scale;
            const ex = (end.x - offsetX) * scale;
            const ey = (end.y - offsetY) * scale;

            const dx = ex - sx;
            const dy = ey - sy;
            const length = Math.hypot(dx, dy);

            if (length < 2) return;

            const angle = Math.atan2(dy, dx);
            const headLength = Math.max(16 * scale, scaledWidth * 3.5);
            const headAngle = Math.PI / 6; // 30 grados

            // Punto base donde el cuerpo de la flecha se une a la cabeza
            const bx = ex - (headLength * 0.75) * Math.cos(angle);
            const by = ey - (headLength * 0.75) * Math.sin(angle);

            // Esquinas laterales de la punta de la flecha
            const x1 = ex - headLength * Math.cos(angle - headAngle);
            const y1 = ey - headLength * Math.sin(angle - headAngle);
            const x2 = ex - headLength * Math.cos(angle + headAngle);
            const y2 = ey - headLength * Math.sin(angle + headAngle);

            // 1. Trazar el cuerpo de la flecha (termina exactamente en la base)
            cr.moveTo(sx, sy);
            cr.lineTo(bx, by);
            cr.stroke();

            // 2. Trazar la cabeza sólida de la flecha
            cr.newPath();
            cr.moveTo(ex, ey);
            cr.lineTo(x1, y1);
            cr.lineTo(bx, by);
            cr.lineTo(x2, y2);
            cr.closePath();
            cr.fill();
        } else if (tool === ToolType.TEXT) {
            if (!text) return;

            const tx = (x - offsetX) * scale;
            const ty = (y - offsetY) * scale;
            const scaledFontSize = (fontSize || 22) * scale;

            cr.selectFontFace('Sans', cairo.FontSlant.NORMAL, cairo.FontWeight.BOLD);
            cr.setFontSize(scaledFontSize);
            cr.moveTo(tx, ty);
            cr.showText(text);
        }
    } finally {
        cr.restore();
    }
}

/**
 * Actor visual interactivo para pintar trazos sobre la pantalla
 */
export const DrawingCanvas = GObject.registerClass({
    GTypeName: 'ScreenshotDrawingCanvas',
    Signals: {
        'draw-started': {},
        'draw-ended': {},
    },
}, class DrawingCanvas extends St.DrawingArea {
    _init(model, params = {}) {
        super._init({
            reactive: true,
            can_focus: true,
            ...params,
        });

        this._model = model;
        this._isDrawing = false;
        this._activeTextEntry = null;

        this._modelListener = () => {
            this.queue_repaint();
        };
        this._model.addListener(this._modelListener);

        this.connect('repaint', this._onRepaint.bind(this));
    }

    _onRepaint(area) {
        const cr = area.get_context();
        if (!cr) return;

        try {
            // Limpiar área transparente
            cr.save();
            cr.setOperator(cairo.Operator.CLEAR);
            cr.paint();
            cr.restore();

            // Renderizar todos los trazos guardados
            for (const stroke of this._model.strokes) {
                renderStroke(cr, stroke, 1.0, 0, 0);
            }

            // Renderizar el trazo activo actual
            if (this._model.currentStroke) {
                renderStroke(cr, this._model.currentStroke, 1.0, 0, 0);
            }
        } catch (err) {
            console.error('Error in DrawingCanvas repaint:', err);
        }
    }

    vfunc_button_press_event(event) {
        if (event.get_button() === Clutter.BUTTON_PRIMARY) {
            const [x, y] = event.get_coords();

            if (this._activeTextEntry) {
                this._commitTextEntry();
                return Clutter.EVENT_STOP;
            }

            if (this._model.activeTool === ToolType.TEXT) {
                this._spawnTextEntry(x, y);
                return Clutter.EVENT_STOP;
            }

            this._isDrawing = true;
            this.emit('draw-started');
            this._model.startStroke(x, y);
            this.queue_repaint();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_motion_event(event) {
        if (this._isDrawing) {
            const [x, y] = event.get_coords();
            this._model.updateStroke(x, y);
            this.queue_repaint();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_button_release_event(event) {
        if (event.get_button() === Clutter.BUTTON_PRIMARY && this._isDrawing) {
            this._isDrawing = false;
            this._model.endStroke();
            this.emit('draw-ended');
            this.queue_repaint();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_scroll_event(event) {
        const direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.UP) {
            this._model.increaseSize();
            return Clutter.EVENT_STOP;
        } else if (direction === Clutter.ScrollDirection.DOWN) {
            this._model.decreaseSize();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _spawnTextEntry(x, y) {
        const fontSize = Math.max(18, this._model.activeWidth * 3.5);
        const color = this._model.activeColor.hex || '#e01b24';

        const entry = new St.Entry({
            style_class: 'screenshot-draw-text-entry',
            style: `font-size: ${fontSize}px; color: ${color};`,
            can_focus: true,
            hint_text: 'Escribe aquí...',
        });

        entry.set_position(x, y);
        this.get_parent().add_child(entry);
        entry.grab_key_focus();

        const commit = () => {
            const txt = entry.get_text();
            if (txt && txt.trim().length > 0) {
                this._model.addTextStroke(x, y + fontSize, txt);
            }
            if (entry.get_parent()) {
                entry.get_parent().remove_child(entry);
            }
            entry.destroy();
            this._activeTextEntry = null;
        };

        const cancel = () => {
            if (entry.get_parent()) {
                entry.get_parent().remove_child(entry);
            }
            entry.destroy();
            this._activeTextEntry = null;
        };

        entry.clutter_text.connect('activate', commit);
        entry.clutter_text.connect('key-press-event', (actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                cancel();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._activeTextEntry = { entry, commit };
    }

    _commitTextEntry() {
        if (this._activeTextEntry) {
            this._activeTextEntry.commit();
        }
    }

    destroy() {
        if (this._activeTextEntry) {
            this._activeTextEntry.commit();
        }
        if (this._model && this._modelListener) {
            this._model.removeListener(this._modelListener);
            this._modelListener = null;
        }
        super.destroy();
    }
});
