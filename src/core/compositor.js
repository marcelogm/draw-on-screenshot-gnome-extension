import cairo from 'gi://cairo';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import { renderStroke } from '../ui/drawingCanvas.js';

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

        // Capa transparente que contiene ÚNICAMENTE los trazos. La captura base
        // no se pinta aquí: se mantiene en su Pixbuf y la capa se funde encima.
        const surface = new cairo.ImageSurface(cairo.Format.ARGB32, width, height);
        const cr = new cairo.Context(surface);

        const offsetX = Number.isFinite(origin?.[0]) ? origin[0] : 0;
        const offsetY = Number.isFinite(origin?.[1]) ? origin[1] : 0;

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
