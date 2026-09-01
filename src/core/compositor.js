import cairo from 'gi://cairo';
import Gdk from 'gi://Gdk?version=4.0';
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

        const surface = new cairo.ImageSurface(cairo.Format.ARGB32, width, height);
        const cr = new cairo.Context(surface);

        // 1. Estampar la captura base
        Gdk.cairo_set_source_pixbuf(cr, basePixbuf, 0, 0);
        cr.paint();

        // 2. Origen de la región capturada, en píxeles de buffer
        const offsetX = Number.isFinite(origin?.[0]) ? origin[0] : 0;
        const offsetY = Number.isFinite(origin?.[1]) ? origin[1] : 0;

        // 3. Estampar los trazos
        for (const stroke of model.strokes) {
            renderStroke(cr, stroke, scale, offsetX, offsetY);
        }
        if (model.currentStroke) {
            renderStroke(cr, model.currentStroke, scale, offsetX, offsetY);
        }

        cr.$dispose();

        // 4. Volver a Pixbuf con los dibujos integrados
        const finalPixbuf = Gdk.pixbuf_get_from_surface(surface, 0, 0, width, height);
        if (!finalPixbuf) {
            throw new Error('No se pudo extraer el Pixbuf de la superficie Cairo');
        }

        return {
            bytes: ScreenshotCompositor._toPngBytes(finalPixbuf),
            pixbuf: finalPixbuf,
        };
    }

    static _toPngBytes(pixbuf) {
        const [ok, buffer] = pixbuf.save_to_bufferv('png', [], []);
        if (!ok) {
            throw new Error('Falló la codificación PNG de la captura');
        }
        return GLib.Bytes.new(buffer);
    }
}
