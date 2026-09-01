import cairo from 'gi://cairo';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import { renderStroke } from '../ui/drawingCanvas.js';
import { ToolType } from './drawingModel.js';
import { logWarning } from './log.js';

/**
 * Compositor de imagen: estampa los trazos vectoriales sobre el Pixbuf capturado.
 */
export class ScreenshotCompositor {
    /**
     * Combina el Pixbuf original con los trazos dibujados.
     *
     * @param {GdkPixbuf.Pixbuf} basePixbuf Pixbuf capturado por Shell.Screenshot.
     *   Se modifica in situ.
     * @param {DrawingModel} model Modelo con los trazos, en coordenadas lógicas del stage.
     * @param {Array<number>|null} origin Origen [x, y] de la captura, en PÍXELES DE BUFFER.
     *   Para selección/pantalla son los dos primeros valores de
     *   `ScreenshotUI._getSelectedGeometry(true)`, que ya vienen escalados.
     *   Para ventana, el origen del buffer rect por su factor de escala.
     * @param {number} scale Factor de escala de la superficie capturada (HiDPI).
     * @returns {{ bytes: GLib.Bytes, pixbuf: GdkPixbuf.Pixbuf }}
     */
    static composite(basePixbuf, model, origin, scale = 1.0) {
        if (!basePixbuf) {
            throw new Error('basePixbuf es requerido para el compositing');
        }

        if (!model || !model.hasStrokes()) {
            return {
                bytes: ScreenshotCompositor._toPngBytes(basePixbuf),
                pixbuf: basePixbuf,
            };
        }

        const width = basePixbuf.get_width();
        const height = basePixbuf.get_height();

        const offsetX = Number.isFinite(origin?.[0]) ? origin[0] : 0;
        const offsetY = Number.isFinite(origin?.[1]) ? origin[1] : 0;

        // El pixelado se aplica ANTES que la capa vectorial, y directamente
        // sobre los píxeles capturados: es lo único que no puede dibujarse,
        // porque consiste en reemplazar la imagen que hay debajo.
        ScreenshotCompositor._applyPixelation(
            basePixbuf, model, offsetX, offsetY, scale);

        // Capa transparente que contiene ÚNICAMENTE los trazos. La captura base
        // no se pinta aquí: se mantiene en su Pixbuf y la capa se funde encima.
        const surface = new cairo.ImageSurface(cairo.Format.ARGB32, width, height);
        const cr = new cairo.Context(surface);

        for (const stroke of model.strokes) {
            renderStroke(cr, stroke, scale, offsetX, offsetY);
        }
        if (model.currentStroke) {
            renderStroke(cr, model.currentStroke, scale, offsetX, offsetY);
        }

        cr.$dispose();
        surface.flush();

        const layer = ScreenshotCompositor._surfaceToPixbuf(surface);
        layer.composite(
            basePixbuf,
            0, 0, width, height,
            0, 0, 1, 1,
            GdkPixbuf.InterpType.NEAREST,
            255
        );

        return {
            bytes: ScreenshotCompositor._toPngBytes(basePixbuf),
            pixbuf: basePixbuf,
        };
    }

    /**
     * Sustituye cada región marcada con la herramienta de pixelado por una
     * versión reducida y vuelta a ampliar sin interpolación, que es exactamente
     * el mosaico de las capturas censuradas.
     *
     * Todo el trabajo lo hace GdkPixbuf en C: reducir promedia los píxeles de
     * cada bloque y ampliar con NEAREST los repite. No hay que recorrer píxeles
     * desde JS, que además no puede leerlos.
     */
    static _applyPixelation(basePixbuf, model, offsetX, offsetY, scale) {
        const width = basePixbuf.get_width();
        const height = basePixbuf.get_height();

        for (const stroke of model.strokes) {
            if (stroke.tool !== ToolType.PIXELATE) continue;
            const { start, end } = stroke;
            if (!start || !end) continue;

            // Coordenadas lógicas del stage -> píxeles del pixbuf capturado.
            let x0 = Math.round(Math.min(start.x, end.x) * scale - offsetX);
            let y0 = Math.round(Math.min(start.y, end.y) * scale - offsetY);
            let x1 = Math.round(Math.max(start.x, end.x) * scale - offsetX);
            let y1 = Math.round(Math.max(start.y, end.y) * scale - offsetY);

            // Recortar a la imagen: el trazo puede desbordar la selección.
            x0 = Math.max(0, x0);
            y0 = Math.max(0, y0);
            x1 = Math.min(width, x1);
            y1 = Math.min(height, y1);

            const w = x1 - x0;
            const h = y1 - y0;
            if (w < 2 || h < 2) continue;

            const block = Math.max(2, Math.round((stroke.block ?? 12) * scale));
            const smallW = Math.max(1, Math.round(w / block));
            const smallH = Math.max(1, Math.round(h / block));

            try {
                const region = basePixbuf.new_subpixbuf(x0, y0, w, h);
                const shrunk = region.scale_simple(
                    smallW, smallH, GdkPixbuf.InterpType.BILINEAR);
                const mosaic = shrunk?.scale_simple(
                    w, h, GdkPixbuf.InterpType.NEAREST);
                if (!mosaic) continue;

                mosaic.copy_area(0, 0, w, h, basePixbuf, x0, y0);
            } catch (e) {
                logWarning('No se pudo pixelar una región; se deja sin censurar.');
            }
        }
    }

    /**
     * Convierte una ImageSurface de Cairo en un Pixbuf.
     *
     * El puente natural sería `Gdk.pixbuf_get_from_surface()`, pero las reglas de
     * extensions.gnome.org prohíben importar Gdk, Gtk o Adw dentro del proceso de
     * GNOME Shell: entran en conflicto con Clutter. GJS tampoco expone
     * `cairo_image_surface_get_data()`, así que no se pueden leer los píxeles a
     * mano. Lo que queda es un PNG temporal, con la ventaja de que toda la
     * conversión ocurre en C y no hay que recorrer píxeles desde JS.
     *
     * El archivo contiene sólo los trazos sobre fondo transparente: los píxeles
     * de la pantalla capturada nunca llegan al disco por esta vía.
     */
    static _surfaceToPixbuf(surface) {
        let path = null;
        try {
            const [fd, tmpPath] = GLib.file_open_tmp('draw-on-screenshot-XXXXXX.png');
            GLib.close(fd);
            path = tmpPath;

            surface.writeToPNG(path);

            const pixbuf = GdkPixbuf.Pixbuf.new_from_file(path);
            if (!pixbuf) {
                throw new Error('No se pudo leer la capa de anotaciones');
            }
            return pixbuf;
        } finally {
            if (path) {
                try {
                    GLib.unlink(path);
                } catch (e) {
                    // El temporal es prescindible; no arruinar la captura por esto.
                }
            }
        }
    }

    static _toPngBytes(pixbuf) {
        const [ok, buffer] = pixbuf.save_to_bufferv('png', [], []);
        if (!ok) {
            throw new Error('Falló la codificación PNG de la captura');
        }
        return GLib.Bytes.new(buffer);
    }
}
