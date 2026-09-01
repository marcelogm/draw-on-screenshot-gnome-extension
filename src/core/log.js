/**
 * Registro centralizado.
 *
 * Las reglas de revisión de extensions.gnome.org desaconsejan el registro
 * abundante y sin condicionar. Concentrar aquí las llamadas a `console` deja el
 * resto del código sin ruido y permite silenciar la traza de depuración desde un
 * único sitio.
 */

const PREFIX = 'draw-on-screenshot:';

/** Traza de desarrollo. Apagada en las versiones publicadas. */
export const DEBUG = false;

/** Fallo real que conviene que quede en el journal. */
export function logError(message, error = null) {
    if (error) {
        console.error(`${PREFIX} ${message}`, error);
    } else {
        console.error(`${PREFIX} ${message}`);
    }
}

/** Situación anómala de la que la extensión sí sabe recuperarse. */
export function logWarning(message) {
    console.warn(`${PREFIX} ${message}`);
}

/** Sólo visible con DEBUG activado. */
export function logDebug(message) {
    if (DEBUG) {
        console.log(`${PREFIX} ${message}`);
    }
}
