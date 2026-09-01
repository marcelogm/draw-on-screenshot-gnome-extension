/**
 * Tipos de herramientas de dibujo estilo Lightshot
 */
export const ToolType = {
    PEN: 'pen',
    LINE: 'line',
    ARROW: 'arrow',
    RECT: 'rect',
    HIGHLIGHTER: 'highlighter',
    TEXT: 'text',
};

/**
 * Paleta de colores inspirada en Lightshot y GNOME Adwaita
 */
export const ColorPalette = [
    { name: 'Rojo', hex: '#e01b24', r: 0.878, g: 0.106, b: 0.141, a: 1.0 },
    { name: 'Azul', hex: '#3584e4', r: 0.208, g: 0.518, b: 0.894, a: 1.0 },
    { name: 'Verde', hex: '#33d17a', r: 0.200, g: 0.820, b: 0.478, a: 1.0 },
    { name: 'Amarillo', hex: '#f6d32d', r: 0.965, g: 0.827, b: 0.176, a: 1.0 },
    { name: 'Naranja', hex: '#ff7800', r: 1.000, g: 0.470, b: 0.000, a: 1.0 },
    { name: 'Violeta', hex: '#9141ac', r: 0.568, g: 0.254, b: 0.674, a: 1.0 },
    { name: 'Blanco', hex: '#ffffff', r: 1.000, g: 1.000, b: 1.000, a: 1.0 },
    { name: 'Negro', hex: '#000000', r: 0.000, g: 0.000, b: 0.000, a: 1.0 },
];

export const AvailableSizes = [2, 3, 4, 6, 8, 12, 16, 24, 32];

/** Distancia mínima entre puntos consecutivos de un trazo libre, en px lógicos. */
const MIN_POINT_DISTANCE = 2;

/**
 * Modelo de estado del lienzo de dibujo
 */
export class DrawingModel {
    constructor() {
        this.strokes = [];
        this.currentStroke = null;
        this.activeTool = null;
        this.activeColor = ColorPalette[0]; // Rojo por defecto
        this.activeWidth = 6;
        this._redoStack = [];
        this._listeners = new Set();
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
                console.error('Error in DrawingModel listener:', e);
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
        const currentIndex = ColorPalette.findIndex(c => c.hex === this.activeColor.hex);
        const nextIndex = (currentIndex + 1) % ColorPalette.length;
        this.setActiveColor(ColorPalette[nextIndex]);
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

    startStroke(x, y) {
        const isHighlighter = this.activeTool === ToolType.HIGHLIGHTER;
        const color = {
            r: this.activeColor.r,
            g: this.activeColor.g,
            b: this.activeColor.b,
            a: isHighlighter ? 0.35 : (this.activeColor.a ?? 1.0),
        };
        const width = isHighlighter ? this.activeWidth * 3.5 : this.activeWidth;
        const isFreehand = this.activeTool === ToolType.PEN || isHighlighter;

        this.currentStroke = {
            tool: this.activeTool,
            color,
            width,
            start: { x, y },
            end: { x, y },
            // Line/Rect/Arrow sólo usan start/end: no acumulan puntos.
            points: isFreehand ? [{ x, y }] : null,
        };
        this._notify();
    }

    updateStroke(x, y) {
        if (!this.currentStroke) return;

        this.currentStroke.end = { x, y };

        const points = this.currentStroke.points;
        if (points) {
            // Descartar puntos casi coincidentes: reduce el coste de repintado.
            const last = points[points.length - 1];
            if (Math.hypot(x - last.x, y - last.y) < MIN_POINT_DISTANCE) {
                return;
            }
            points.push({ x, y });
        }

        this._notify();
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
        this._notify();
    }

    hasStrokes() {
        return this.strokes.length > 0 || this.currentStroke !== null;
    }
}
