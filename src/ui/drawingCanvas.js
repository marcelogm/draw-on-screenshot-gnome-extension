import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import cairo from 'gi://cairo';
import { ToolType } from '../core/drawingModel.js';
import { logError } from '../core/log.js';

/**
 * Renderiza un trazo sobre un contexto de Cairo.
 * Función pura, reutilizada por la UI en vivo y por el compositor final.
 *
 * Sistemas de coordenadas — importante:
 *   - Los puntos del trazo (`stroke`) están SIEMPRE en coordenadas lógicas del stage.
 *   - `scale` convierte de coordenadas lógicas a píxeles de buffer (HiDPI).
 *   - `offsetX` / `offsetY` son el origen del destino, ya en PÍXELES DE BUFFER
 *     (así los devuelve `ScreenshotUI._getSelectedGeometry(true)`).
 *
 * De ahí que la transformación correcta sea `punto * scale - offset`, y no
 * `(punto - offset) * scale`: mezclar ambos espacios desplazaba el dibujo en
 * pantallas HiDPI.
 */
export function renderStroke(cr, stroke, scale = 1.0, offsetX = 0, offsetY = 0) {
    if (!stroke) return;

    const { color, width, tool, points, start, end, text, fontSize, x, y } = stroke;
    const scaledWidth = width * scale;

    const tx = px => px * scale - offsetX;
    const ty = py => py * scale - offsetY;

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
                cr.arc(tx(p.x), ty(p.y), scaledWidth / 2, 0, 2 * Math.PI);
                cr.fill();
            } else {
                cr.moveTo(tx(points[0].x), ty(points[0].y));
                for (let i = 1; i < points.length; i++) {
                    cr.lineTo(tx(points[i].x), ty(points[i].y));
                }
                cr.stroke();
            }
        } else if (tool === ToolType.LINE) {
            if (!start || !end) return;

            cr.moveTo(tx(start.x), ty(start.y));
            cr.lineTo(tx(end.x), ty(end.y));
            cr.stroke();
        } else if (tool === ToolType.RECT) {
            if (!start || !end) return;

            const rx = tx(Math.min(start.x, end.x));
            const ry = ty(Math.min(start.y, end.y));
            const rw = Math.abs(end.x - start.x) * scale;
            const rh = Math.abs(end.y - start.y) * scale;

            cr.rectangle(rx, ry, rw, rh);
            cr.stroke();
        } else if (tool === ToolType.ARROW) {
            if (!start || !end) return;

            const sx = tx(start.x);
            const sy = ty(start.y);
            const ex = tx(end.x);
            const ey = ty(end.y);

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

            // Esquinas laterales de la punta
            const x1 = ex - headLength * Math.cos(angle - headAngle);
            const y1 = ey - headLength * Math.sin(angle - headAngle);
            const x2 = ex - headLength * Math.cos(angle + headAngle);
            const y2 = ey - headLength * Math.sin(angle + headAngle);

            // 1. Cuerpo, terminando exactamente en la base de la cabeza
            cr.moveTo(sx, sy);
            cr.lineTo(bx, by);
            cr.stroke();

            // 2. Cabeza sólida
            cr.newPath();
            cr.moveTo(ex, ey);
            cr.lineTo(x1, y1);
            cr.lineTo(bx, by);
            cr.lineTo(x2, y2);
            cr.closePath();
            cr.fill();
        } else if (tool === ToolType.TEXT) {
            if (!text) return;

            cr.selectFontFace('Sans', cairo.FontSlant.NORMAL, cairo.FontWeight.BOLD);
            cr.setFontSize((fontSize || 22) * scale);
            cr.moveTo(tx(x), ty(y));
            cr.showText(text);
        }
    } finally {
        cr.restore();
    }
}

/**
 * Actor visual interactivo para pintar trazos.
 *
 * El actor NO cubre necesariamente todo el stage: el patcher lo recorta al área
 * seleccionada para que el selector de área siga siendo utilizable fuera de ella.
 * Los trazos se guardan en coordenadas del stage, así que al pintar en vivo hay
 * que restar la posición del propio actor.
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
        this._pointerX = 0;
        this._pointerY = 0;
        this._pointerInside = false;

        // Sin herramienta activa el lienzo debe ser INERTE, no sólo ignorar el
        // clic: Clutter entrega el evento al actor reactivo más alto, y devolver
        // EVENT_PROPAGATE lo pasa al padre, nunca al selector de área que está
        // debajo. Sólo dejando de ser reactivo el selector vuelve a recibirlo.
        this.reactive = this._model.hasActiveTool();

        this._modelListener = () => {
            this.reactive = this._model.hasActiveTool();
            // Si el modelo descartó el trazo en curso (deshacer, cambio de
            // herramienta), el gesto de arrastre deja de ser válido.
            if (this._isDrawing && !this._model.currentStroke) {
                this._isDrawing = false;
            }
            this.queue_repaint();
        };
        this._model.addListener(this._modelListener);

        this.connect('repaint', this._onRepaint.bind(this));
    }

    _onRepaint(area) {
        const cr = area.get_context();
        if (!cr) return;

        try {
            // Origen del actor en coordenadas del stage: los trazos se guardan
            // en ese espacio, y Cairo pinta en coordenadas locales del actor.
            const [ox, oy] = area.get_transformed_position();
            const offsetX = Number.isFinite(ox) ? ox : 0;
            const offsetY = Number.isFinite(oy) ? oy : 0;

            cr.save();
            cr.setOperator(cairo.Operator.CLEAR);
            cr.paint();
            cr.restore();

            for (const stroke of this._model.strokes) {
                renderStroke(cr, stroke, 1.0, offsetX, offsetY);
            }

            if (this._model.currentStroke) {
                renderStroke(cr, this._model.currentStroke, 1.0, offsetX, offsetY);
            }

            this._renderBrushPreview(cr, offsetX, offsetY);
        } catch (err) {
            logError('Fallo al repintar el lienzo', err);
        }
    }

    /**
     * Círculo que anticipa el grosor del trazo bajo el cursor, al estilo de
     * Flameshot. Se dibuja con doble contorno claro y oscuro para que se lea
     * sobre cualquier fondo.
     */
    _renderBrushPreview(cr, offsetX, offsetY) {
        if (!this._pointerInside || this._isDrawing) return;
        if (!this._model.hasActiveTool()) return;
        if (this._model.activeTool === ToolType.TEXT) return;

        const isHighlighter = this._model.activeTool === ToolType.HIGHLIGHTER;
        const width = isHighlighter ? this._model.activeWidth * 3.5 : this._model.activeWidth;
        const radius = Math.max(width / 2, 1.5);

        const cx = this._pointerX - offsetX;
        const cy = this._pointerY - offsetY;

        cr.save();
        try {
            const color = this._model.activeColor;

            cr.setLineWidth(1);

            cr.setSourceRGBA(0, 0, 0, 0.55);
            cr.arc(cx, cy, radius + 1, 0, 2 * Math.PI);
            cr.stroke();

            cr.setSourceRGBA(1, 1, 1, 0.9);
            cr.arc(cx, cy, radius, 0, 2 * Math.PI);
            cr.stroke();

            // Punto central con el color activo, para saber con qué se pinta.
            cr.setSourceRGBA(color.r, color.g, color.b, 0.85);
            cr.arc(cx, cy, 1.5, 0, 2 * Math.PI);
            cr.fill();
        } finally {
            cr.restore();
        }
    }

    vfunc_enter_event(event) {
        this._pointerInside = true;
        const [x, y] = event.get_coords();
        this._pointerX = x;
        this._pointerY = y;
        this.queue_repaint();
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_leave_event() {
        this._pointerInside = false;
        this.queue_repaint();
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_button_press_event(event) {
        if (!this._model.hasActiveTool()) {
            return Clutter.EVENT_PROPAGATE;
        }

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
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_motion_event(event) {
        const [x, y] = event.get_coords();
        const moved = Math.abs(x - this._pointerX) >= 1 || Math.abs(y - this._pointerY) >= 1;
        this._pointerX = x;
        this._pointerY = y;
        this._pointerInside = true;

        if (this._isDrawing) {
            this._model.updateStroke(x, y);
            return Clutter.EVENT_STOP;
        }

        // Repintar sólo si el preview se movió de verdad: el lienzo cubre toda
        // la pantalla y repintar por cada evento sub-pixel es caro.
        if (moved && this._model.hasActiveTool()) {
            this.queue_repaint();
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_button_release_event(event) {
        if (event.get_button() === Clutter.BUTTON_PRIMARY && this._isDrawing) {
            this._isDrawing = false;
            this._model.endStroke();
            this.emit('draw-ended');
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_scroll_event(event) {
        const [x, y] = event.get_coords();
        this._pointerX = x;
        this._pointerY = y;
        this._pointerInside = true;

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

    /** Reposiciona el preview del pincel desde fuera (p. ej. Ctrl + rueda). */
    setPointer(x, y) {
        this._pointerX = x;
        this._pointerY = y;
        this._pointerInside = true;
        this.queue_repaint();
    }

    get hasTextEntry() {
        return this._activeTextEntry !== null;
    }

    _spawnTextEntry(x, y) {
        const fontSize = Math.max(18, this._model.activeWidth * 3.5);
        const color = this._model.activeColor.hex || '#e01b24';

        const entry = new St.Entry({
            style_class: 'screenshot-draw-text-entry',
            style: `font-size: ${fontSize}px; color: ${color};`,
            can_focus: true,
        });

        const parent = this.get_parent();
        if (!parent) return;

        entry.set_position(x, y);
        parent.add_child(entry);
        entry.grab_key_focus();

        const dismiss = () => {
            if (entry.get_parent()) {
                entry.get_parent().remove_child(entry);
            }
            entry.destroy();
            this._activeTextEntry = null;
        };

        const commit = () => {
            const txt = entry.get_text();
            if (txt && txt.trim().length > 0) {
                this._model.addTextStroke(x, y + fontSize, txt);
            }
            dismiss();
        };

        entry.clutter_text.connect('activate', commit);
        entry.clutter_text.connect('key-press-event', (actor, keyEvent) => {
            if (keyEvent.get_key_symbol() === Clutter.KEY_Escape) {
                dismiss();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._activeTextEntry = { entry, commit, dismiss };
    }

    _commitTextEntry() {
        if (this._activeTextEntry) {
            this._activeTextEntry.commit();
        }
    }

    /** Cierra la entrada de texto abierta sin guardar nada. */
    cancelTextEntry() {
        if (this._activeTextEntry) {
            this._activeTextEntry.dismiss();
        }
    }

    destroy() {
        if (this._activeTextEntry) {
            this._activeTextEntry.dismiss();
        }
        if (this._model && this._modelListener) {
            this._model.removeListener(this._modelListener);
            this._modelListener = null;
        }
        super.destroy();
    }
});
