import { logError } from './log.js';
import { parseHexColor } from './settings.js';

/**
 * Tipos de herramientas de dibujo estilo Lightshot
 */
export const ToolType = {
    PEN: 'pen',
    LINE: 'line',
    ARROW: 'arrow',
    RECT: 'rect',
    ELLIPSE: 'ellipse',
    HIGHLIGHTER: 'highlighter',
    TEXT: 'text',
    COUNTER: 'counter',
    PIXELATE: 'pixelate',
};

/** Orden canónico de las herramientas; también valida `enabled-tools`. */
export const ToolOrder = [
    ToolType.PEN,
    ToolType.LINE,
    ToolType.ARROW,
    ToolType.RECT,
    ToolType.ELLIPSE,
    ToolType.HIGHLIGHTER,
    ToolType.TEXT,
    ToolType.COUNTER,
    ToolType.PIXELATE,
];

/** Herramientas que se arrastran de una esquina a otra. */
const SHAPE_TOOLS = new Set([
    ToolType.LINE,
    ToolType.ARROW,
    ToolType.RECT,
    ToolType.ELLIPSE,
    ToolType.PIXELATE,
]);

/**
 * Paleta por defecto, inspirada en Lightshot y GNOME Adwaita. Las preferencias
 * pueden sustituirla por completo; estos valores son sólo el punto de partida y
 * el respaldo si la lista configurada queda vacía o ilegible.
 *
 * `name` es sólo una etiqueta de depuración: la interfaz identifica cada color
 * por su valor hexadecimal, que es lo que guardan las preferencias.
 */
export const ColorPalette = [
    { name: 'Red', hex: '#e01b24', r: 0.878, g: 0.106, b: 0.141, a: 1.0 },
    { name: 'Blue', hex: '#3584e4', r: 0.208, g: 0.518, b: 0.894, a: 1.0 },
    { name: 'Green', hex: '#33d17a', r: 0.200, g: 0.820, b: 0.478, a: 1.0 },
    { name: 'Yellow', hex: '#f6d32d', r: 0.965, g: 0.827, b: 0.176, a: 1.0 },
    { name: 'Orange', hex: '#ff7800', r: 1.000, g: 0.470, b: 0.000, a: 1.0 },
    { name: 'Purple', hex: '#9141ac', r: 0.568, g: 0.254, b: 0.674, a: 1.0 },
    { name: 'White', hex: '#ffffff', r: 1.000, g: 1.000, b: 1.000, a: 1.0 },
    { name: 'Black', hex: '#000000', r: 0.000, g: 0.000, b: 0.000, a: 1.0 },
];

export const AvailableSizes = [2, 3, 4, 6, 8, 12, 16, 24, 32];

/** Distancia mínima entre puntos consecutivos de un trazo libre, en px lógicos. */
const MIN_POINT_DISTANCE = 2;

/** Un octavo de vuelta: paso de imantado angular con Mayús en línea y flecha. */
const SNAP_ANGLE = Math.PI / 4;

/**
 * Modelo de estado del lienzo de dibujo
 */
export class DrawingModel {
    constructor() {
        this.palette = [...ColorPalette];
        this.strokes = [];
        this.currentStroke = null;
        this.activeTool = null;
        this.activeColor = this.palette[0];
        this.activeWidth = 6;
        this.fillShapes = false;
        this.strokeShadow = false;
        this.textBold = false;
        this.fontFamily = 'Sans';
        this.counterStart = 1;
        this.pixelateBlock = 12;
        this._redoStack = [];
        this._listeners = new Set();
    }

    /**
     * Vuelca las preferencias en el modelo. Se llama al habilitar la extensión y
     * cada vez que cambia GSettings, así que debe tolerar valores basura sin
     * dejar el modelo en un estado inservible.
     *
     * @param {object} prefs
     */
    applySettings(prefs = {}) {
        if (Array.isArray(prefs.palette)) {
            const parsed = prefs.palette
                .map(hex => {
                    const color = parseHexColor(hex);
                    return color ? { name: color.hex, ...color } : null;
                })
                .filter(Boolean);
            if (parsed.length > 0) {
                this.palette = parsed;
            }
        }

        // Conservar el color activo si sigue en la paleta; si no, el primero.
        const stillThere = this.palette.find(c => c.hex === this.activeColor?.hex);
        this.activeColor = stillThere ?? this.palette[0];

        if (Number.isFinite(prefs.defaultWidth)) {
            this.defaultWidth = Math.max(2, Math.min(48, prefs.defaultWidth));
            this.activeWidth = this.defaultWidth;
        }
        if (typeof prefs.fillShapes === 'boolean') this.fillShapes = prefs.fillShapes;
        if (typeof prefs.strokeShadow === 'boolean') this.strokeShadow = prefs.strokeShadow;
        if (typeof prefs.textBold === 'boolean') this.textBold = prefs.textBold;
        if (typeof prefs.fontFamily === 'string' && prefs.fontFamily.length > 0) {
            this.fontFamily = prefs.fontFamily;
        }
        if (Number.isFinite(prefs.counterStart)) this.counterStart = prefs.counterStart;
        if (Number.isFinite(prefs.pixelateBlock)) {
            this.pixelateBlock = Math.max(4, Math.min(64, prefs.pixelateBlock));
        }

        this._notify();
    }

    addListener(callback) {
        this._listeners.add(callback);
    }

    removeListener(callback) {
        this._listeners.delete(callback);
    }

    _notify() {
        for (const listener of this._listeners) {
            try {
                listener();
            } catch (e) {
                logError('Fallo en un listener del modelo', e);
            }
        }
    }

    setActiveTool(tool) {
        if (this.currentStroke) {
            this.endStroke();
        }
        if (this.activeTool !== tool) {
            this.activeTool = tool;
            this._notify();
        }
    }

    /**
     * Alterna una herramienta: volver a pulsar la activa la desactiva y deja el
     * lienzo inerte, de modo que se pueda seguir usando el selector de área.
     */
    toggleTool(tool) {
        this.setActiveTool(this.activeTool === tool ? null : tool);
    }

    hasActiveTool() {
        return this.activeTool !== null;
    }

    setActiveColor(color) {
        if (this.currentStroke) {
            this.endStroke();
        }
        this.activeColor = color;
        this._notify();
    }

    cycleColor() {
        const currentIndex = this.palette.findIndex(c => c.hex === this.activeColor.hex);
        const nextIndex = (currentIndex + 1) % this.palette.length;
        this.setActiveColor(this.palette[nextIndex]);
    }

    setActiveWidth(width) {
        if (this.currentStroke) {
            this.endStroke();
        }
        this.activeWidth = Math.max(2, Math.min(48, width));
        this._notify();
    }

    increaseSize() {
        const current = this.activeWidth;
        const next = AvailableSizes.find(s => s > current);
        if (next) {
            this.setActiveWidth(next);
        } else if (current < 48) {
            this.setActiveWidth(current + 4);
        }
    }

    decreaseSize() {
        const current = this.activeWidth;
        const prev = [...AvailableSizes].reverse().find(s => s < current);
        if (prev) {
            this.setActiveWidth(prev);
        } else if (current > 2) {
            this.setActiveWidth(current - 2);
        }
    }

    toggleFill() {
        this.fillShapes = !this.fillShapes;
        if (this.currentStroke && 'fill' in this.currentStroke) {
            this.currentStroke.fill = this.fillShapes;
        }
        this._notify();
    }

    startStroke(x, y) {
        const tool = this.activeTool;
        const isHighlighter = tool === ToolType.HIGHLIGHTER;
        const color = {
            r: this.activeColor.r,
            g: this.activeColor.g,
            b: this.activeColor.b,
            a: isHighlighter ? 0.35 : (this.activeColor.a ?? 1.0),
        };
        const width = isHighlighter ? this.activeWidth * 3.5 : this.activeWidth;
        const isFreehand = tool === ToolType.PEN || isHighlighter;

        this.currentStroke = {
            tool,
            color,
            width,
            // `anchor` guarda el punto de pulsación intacto: `start` sí se mueve
            // cuando Ctrl dibuja desde el centro, así que no sirve de referencia.
            anchor: { x, y },
            start: { x, y },
            end: { x, y },
            fill: this.fillShapes,
            shadow: this.strokeShadow,
            block: this.pixelateBlock,
            // Line/Rect/Arrow sólo usan start/end: no acumulan puntos.
            points: isFreehand ? [{ x, y }] : null,
        };
        this._notify();
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {{ shift?: boolean, ctrl?: boolean }} modifiers
     *   Mayús imanta a 45° las líneas y hace cuadrados y círculos perfectos;
     *   Ctrl dibuja la figura desde su centro en lugar de desde una esquina.
     */
    updateStroke(x, y, modifiers = {}) {
        const stroke = this.currentStroke;
        if (!stroke) return;

        const points = stroke.points;
        if (points) {
            stroke.end = { x, y };
            // Descartar puntos casi coincidentes: reduce el coste de repintado.
            const last = points[points.length - 1];
            if (Math.hypot(x - last.x, y - last.y) < MIN_POINT_DISTANCE) {
                return;
            }
            points.push({ x, y });
            this._notify();
            return;
        }

        if (!SHAPE_TOOLS.has(stroke.tool)) {
            stroke.end = { x, y };
            this._notify();
            return;
        }

        const { shift = false, ctrl = false } = modifiers;
        const anchor = stroke.anchor;

        if (stroke.tool === ToolType.LINE || stroke.tool === ToolType.ARROW) {
            stroke.start = { ...anchor };
            stroke.end = shift ? this._snapToAngle(anchor, x, y) : { x, y };
            this._notify();
            return;
        }

        // Rectángulo, elipse y pixelado: rectángulo delimitador.
        let dx = x - anchor.x;
        let dy = y - anchor.y;

        if (shift) {
            const side = Math.max(Math.abs(dx), Math.abs(dy));
            dx = (dx < 0 ? -1 : 1) * side;
            dy = (dy < 0 ? -1 : 1) * side;
        }

        if (ctrl) {
            stroke.start = { x: anchor.x - dx, y: anchor.y - dy };
            stroke.end = { x: anchor.x + dx, y: anchor.y + dy };
        } else {
            stroke.start = { ...anchor };
            stroke.end = { x: anchor.x + dx, y: anchor.y + dy };
        }

        this._notify();
    }

    /** Proyecta (x, y) sobre el múltiplo de 45° más cercano respecto a `anchor`. */
    _snapToAngle(anchor, x, y) {
        const dx = x - anchor.x;
        const dy = y - anchor.y;
        const length = Math.hypot(dx, dy);
        if (length === 0) return { x, y };

        const angle = Math.round(Math.atan2(dy, dx) / SNAP_ANGLE) * SNAP_ANGLE;
        return {
            x: anchor.x + length * Math.cos(angle),
            y: anchor.y + length * Math.sin(angle),
        };
    }

    endStroke() {
        if (!this.currentStroke) return;

        this.strokes.push(this.currentStroke);
        this.currentStroke = null;
        this._redoStack = [];
        this._notify();
    }

    addTextStroke(x, y, text) {
        if (!text || text.trim().length === 0) return;

        const fontSize = Math.max(18, this.activeWidth * 3.5);

        this.strokes.push({
            tool: ToolType.TEXT,
            text: text.trim(),
            color: { ...this.activeColor },
            fontSize,
            bold: this.textBold,
            fontFamily: this.fontFamily,
            shadow: this.strokeShadow,
            width: this.activeWidth,
            x,
            y,
        });
        this._redoStack = [];
        this._notify();
    }

    /**
     * Radio de la burbuja del contador para un grosor de trazo dado. Vive aquí
     * porque lo necesitan tanto el renderizador como la vista previa del lienzo.
     */
    counterRadius(width = this.activeWidth) {
        return Math.max(11, width * 2.2);
    }

    /**
     * Siguiente número de la serie. Se deriva de los trazos existentes en vez de
     * llevar un contador aparte, así deshacer, rehacer y limpiar lo ajustan solos.
     */
    nextCounterValue() {
        let highest = this.counterStart - 1;
        for (const stroke of this.strokes) {
            if (stroke.tool === ToolType.COUNTER && stroke.value > highest) {
                highest = stroke.value;
            }
        }
        return highest + 1;
    }

    addCounterStroke(x, y) {
        this.strokes.push({
            tool: ToolType.COUNTER,
            value: this.nextCounterValue(),
            color: { ...this.activeColor },
            radius: this.counterRadius(),
            fontFamily: this.fontFamily,
            shadow: this.strokeShadow,
            width: this.activeWidth,
            x,
            y,
        });
        this._redoStack = [];
        this._notify();
    }

    undo() {
        if (this.currentStroke) {
            this.currentStroke = null;
        } else if (this.strokes.length > 0) {
            this._redoStack.push(this.strokes.pop());
        }
        this._notify();
    }

    redo() {
        if (this._redoStack.length === 0) return;
        this.strokes.push(this._redoStack.pop());
        this._notify();
    }

    canUndo() {
        return this.strokes.length > 0 || this.currentStroke !== null;
    }

    canRedo() {
        return this._redoStack.length > 0;
    }

    /**
     * Vacía el lienzo. Los trazos quedan en la pila de rehacer, en orden inverso,
     * de modo que rehacer los restituye uno a uno en su orden original de pintado.
     */
    clear() {
        if (this.strokes.length > 0) {
            this._redoStack = [...this.strokes].reverse();
        }
        this.strokes = [];
        this.currentStroke = null;
        this._notify();
    }

    /** Reinicia el modelo por completo, sin conservar historial. */
    reset() {
        this.strokes = [];
        this.currentStroke = null;
        this._redoStack = [];
        this.activeTool = null;
        if (Number.isFinite(this.defaultWidth)) {
            this.activeWidth = this.defaultWidth;
        }
        this._notify();
    }

    hasStrokes() {
        return this.strokes.length > 0 || this.currentStroke !== null;
    }

    /** ¿Hay algo que el compositor final tenga que estampar sobre el pixbuf? */
    hasPixelateStrokes() {
        return this.strokes.some(s => s.tool === ToolType.PIXELATE);
    }
}
