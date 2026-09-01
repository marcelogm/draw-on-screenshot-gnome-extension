import cairo from 'gi://cairo';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib';
import { renderStroke } from '../ui/drawingCanvas.js';

/**
 * Compositor de imagen: Estampa los trazos vectoriales de Cairo sobre el Pixbuf de la captura.
 */
export class ScreenshotCompositor {
    /**
     * Combina el Pixbuf original con los trazos dibujados.
     * 
     * @param {GdkPixbuf.Pixbuf} basePixbuf - Pixbuf original capturado por Shell.Screenshot
     * @param {DrawingModel} model - Modelo con los trazos
     * @param {Array<number>} geometry - [x, y, width, height] en coordenadas del escenario
     * @param {number} scale - Factor de escala de pantalla (HiDPI)
     * @returns {{ bytes: GLib.Bytes, pixbuf: GdkPixbuf.Pixbuf }}
     */
    static composite(basePixbuf, model, geometry, scale = 1.0) {
        if (!basePixbuf) {
            throw new Error('basePixbuf es requerido para el compositing');
        }

        const width = basePixbuf.get_width();
        const height = basePixbuf.get_height();

        if (!model || !model.hasStrokes()) {
            const [ok, buffer] = basePixbuf.save_to_bufferv('png', [], []);
            return {
                bytes: GLib.Bytes.new(buffer),
                pixbuf: basePixbuf,
            };
        }

        // Crear superficie de Cairo del tamaño exacto del Pixbuf final
        const surface = new cairo.ImageSurface(cairo.Format.ARGB32, width, height);
        const cr = new cairo.Context(surface);

        // 1. Estampar la captura de pantalla base
        Gdk.cairo_set_source_pixbuf(cr, basePixbuf, 0, 0);
        cr.paint();

        // 2. Calcular el offset si la captura fue de un área recortada
        const offsetX = (geometry && geometry[0] !== undefined) ? geometry[0] : 0;
        const offsetY = (geometry && geometry[1] !== undefined) ? geometry[1] : 0;

        // 3. Renderizar todos los trazos sobre la imagen con la escala correspondiente
        for (const stroke of model.strokes) {
            renderStroke(cr, stroke, scale, offsetX, offsetY);
        }

        if (model.currentStroke) {
            renderStroke(cr, model.currentStroke, scale, offsetX, offsetY);
        }

        // 4. Extraer el Pixbuf final con los dibujos integrados
        const finalPixbuf = Gdk.pixbuf_get_from_surface(surface, 0, 0, width, height);

        // 5. Convertir a stream de bytes PNG
        const [ok, buffer] = finalPixbuf.save_to_bufferv('png', [], []);
        const bytes = GLib.Bytes.new(buffer);

        return {
            bytes,
            pixbuf: finalPixbuf,
        };
    }
}
