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

/**
 * Modelo de estado del lienzo de dibujo
 */
export class DrawingModel {
    constructor() {
        this.strokes = [];
        this.currentStroke = null;
        this.activeTool = ToolType.PEN;
        this.activeColor = ColorPalette[0]; // Rojo por defecto
        this.activeWidth = 6;
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
        const fontSize = Math.max(16, this.activeWidth * 3.2);

        this.currentStroke = {
            tool: this.activeTool,
            color,
            width,
            fontSize,
            start: { x, y },
            end: { x, y },
            points: [{ x, y }],
        };
        this._notify();
    }

    updateStroke(x, y) {
        if (!this.currentStroke) return;

        this.currentStroke.end = { x, y };
        this.currentStroke.points.push({ x, y });
        this._notify();
    }

    endStroke() {
        if (!this.currentStroke) return;

        if (this.currentStroke.points.length > 0) {
            this.strokes.push(this.currentStroke);
        }
        this.currentStroke = null;
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
        this._notify();
    }

    undo() {
        if (this.currentStroke) {
            this.currentStroke = null;
        } else if (this.strokes.length > 0) {
            this.strokes.pop();
        }
        this._notify();
    }

    clear() {
        this.strokes = [];
        this.currentStroke = null;
        this._notify();
    }

    hasStrokes() {
        return this.strokes.length > 0 || this.currentStroke !== null;
    }
}
