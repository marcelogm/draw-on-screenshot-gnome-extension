import Clutter from 'gi://Clutter';
import { logWarning } from './log.js';

/**
 * Puente entre GSettings y el resto de la extensión.
 *
 * Concentra aquí dos cosas que no conviene repetir: la conversión de `#rrggbb`
 * a los componentes 0..1 que consume Cairo, y el análisis de las cadenas de
 * acelerador estilo GTK que guardan las preferencias.
 */

/** Convierte `#rrggbb` (o `#rgb`) en `{ hex, r, g, b, a }`, o `null` si no es válido. */
export function parseHexColor(hex) {
    if (typeof hex !== 'string') return null;

    let body = hex.trim().replace(/^#/, '');
    if (body.length === 3) {
        body = body.split('').map(c => c + c).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(body)) return null;

    const value = parseInt(body, 16);
    return {
        hex: `#${body.toLowerCase()}`,
        r: ((value >> 16) & 0xff) / 255,
        g: ((value >> 8) & 0xff) / 255,
        b: (value & 0xff) / 255,
        a: 1.0,
    };
}

/** Luminancia relativa aproximada; sirve para elegir texto blanco o negro encima. */
export function luminance(color) {
    return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/**
 * Teclas que, en la práctica, el usuario espera que se comporten igual.
 * Cada grupo se resuelve a un único símbolo canónico antes de comparar, de modo
 * que un atajo guardado como `plus` también responda al `=` de la fila numérica
 * o al `+` del teclado numérico.
 */
const KEY_ALIASES = [
    [Clutter.KEY_plus, Clutter.KEY_equal, Clutter.KEY_KP_Add],
    [Clutter.KEY_minus, Clutter.KEY_underscore, Clutter.KEY_KP_Subtract],
    [Clutter.KEY_Delete, Clutter.KEY_KP_Delete, Clutter.KEY_BackSpace],
];

function canonicalKey(symbol) {
    // Las letras se comparan sin distinguir mayúsculas: `p` y `P` son el mismo
    // atajo, y Shift ya se compara por separado en el campo de modificadores.
    if (symbol >= Clutter.KEY_A && symbol <= Clutter.KEY_Z) {
        return symbol + (Clutter.KEY_a - Clutter.KEY_A);
    }
    for (const group of KEY_ALIASES) {
        if (group.includes(symbol)) return group[0];
    }
    return symbol;
}

const MODIFIER_TOKENS = {
    control: Clutter.ModifierType.CONTROL_MASK,
    primary: Clutter.ModifierType.CONTROL_MASK,
    ctrl: Clutter.ModifierType.CONTROL_MASK,
    shift: Clutter.ModifierType.SHIFT_MASK,
    alt: Clutter.ModifierType.MOD1_MASK,
    super: Clutter.ModifierType.SUPER_MASK,
};

/** Sólo estos modificadores participan en la comparación de atajos. */
export const RELEVANT_MODIFIERS =
    Clutter.ModifierType.CONTROL_MASK |
    Clutter.ModifierType.SHIFT_MASK |
    Clutter.ModifierType.MOD1_MASK |
    Clutter.ModifierType.SUPER_MASK;

/**
 * Analiza una cadena de acelerador de GTK (`<Control><Shift>z`, `Delete`, `p`).
 *
 * No se usa `Gtk.accelerator_parse` porque las reglas de extensions.gnome.org
 * prohíben importar Gtk dentro del proceso de GNOME Shell.
 *
 * @returns {{ symbol: number, mods: number }|null}
 */
export function parseAccelerator(accel) {
    if (typeof accel !== 'string') return null;

    const text = accel.trim();
    if (text.length === 0) return null;

    let mods = 0;
    let rest = text;

    const modRe = /^<([^>]+)>/;
    let match;
    while ((match = modRe.exec(rest)) !== null) {
        const token = match[1].toLowerCase();
        const mask = MODIFIER_TOKENS[token];
        if (mask === undefined) {
            logWarning(`Modificador desconocido en el atajo «${accel}»`);
            return null;
        }
        mods |= mask;
        rest = rest.slice(match[0].length);
    }

    if (rest.length === 0) return null;

    // Los nombres de tecla de GTK y las constantes `Clutter.KEY_*` provienen
    // ambos de la tabla de keysyms de X, así que la correspondencia es directa.
    const symbol = Clutter[`KEY_${rest}`];
    if (typeof symbol !== 'number') {
        logWarning(`Tecla desconocida en el atajo «${accel}»`);
        return null;
    }

    return { symbol: canonicalKey(symbol), mods };
}

/** ¿Coincide el evento de teclado con el atajo analizado? */
export function acceleratorMatches(binding, symbol, state) {
    if (!binding) return false;
    if (canonicalKey(symbol) !== binding.symbol) return false;

    const active = state & RELEVANT_MODIFIERS;
    if (active === binding.mods) return true;

    // Un atajo sin modificadores debe seguir respondiendo con Bloq Mayús puesto
    // o con Mayús pulsada: `P` y `p` son la misma tecla para el usuario.
    if (binding.mods === 0) {
        return (active & ~Clutter.ModifierType.SHIFT_MASK) === 0;
    }
    return false;
}

/** Nombres de tecla que se leen mejor con su símbolo o su forma abreviada. */
const KEY_LABELS = {
    plus: '+',
    equal: '=',
    minus: '−',
    underscore: '_',
    KP_Add: 'Num +',
    KP_Subtract: 'Num −',
    Delete: 'Del',
    BackSpace: '⌫',
    Return: '↵',
    space: '␣',
    Escape: 'Esc',
};

/**
 * Versión legible de un acelerador, para rótulos y tooltips: `<Control>z` se
 * convierte en `Ctrl+Z`. Devuelve cadena vacía si el atajo está desactivado.
 */
export function describeAccelerator(accel) {
    if (typeof accel !== 'string' || accel.trim().length === 0) return '';

    const parts = [];
    let rest = accel.trim();

    const modRe = /^<([^>]+)>/;
    let match;
    while ((match = modRe.exec(rest)) !== null) {
        const token = match[1].toLowerCase();
        if (token === 'control' || token === 'primary' || token === 'ctrl') parts.push('Ctrl');
        else if (token === 'shift') parts.push('Shift');
        else if (token === 'alt') parts.push('Alt');
        else if (token === 'super') parts.push('Super');
        rest = rest.slice(match[0].length);
    }

    if (rest.length === 0) return '';

    parts.push(KEY_LABELS[rest] ?? (rest.length === 1 ? rest.toUpperCase() : rest));
    return parts.join('+');
}
