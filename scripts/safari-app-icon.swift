// Composes the macOS app icon for the Safari container app (used by
// `pnpm safari:icon`): 1024 canvas, 824 px rounded tile with HIG corner
// metrics, light gradient fill, the extension glyph centred at 70% of the tile.
// Usage: make-icon <glyph.svg|png> <out.png>
import AppKit

let args = CommandLine.arguments
let glyphPath = args[1], outPath = args[2]
let size: CGFloat = 1024, tile: CGFloat = 824, inset = (size - tile) / 2, radius: CGFloat = 185.4
guard let glyph = NSImage(contentsOfFile: glyphPath) else { fatalError("glyph") }
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = ctx
ctx.cgContext.clear(CGRect(x: 0, y: 0, width: size, height: size))
let tileRect = CGRect(x: inset, y: inset, width: tile, height: tile)
let path = NSBezierPath(roundedRect: tileRect, xRadius: radius, yRadius: radius)
// soft shadow under the tile
ctx.cgContext.saveGState()
ctx.cgContext.setShadow(offset: CGSize(width: 0, height: -8), blur: 24, color: NSColor.black.withAlphaComponent(0.28).cgColor)
NSColor.white.setFill(); path.fill()
ctx.cgContext.restoreGState()
path.addClip()
let gradient = NSGradient(colors: [NSColor(calibratedRed: 1, green: 1, blue: 1, alpha: 1), NSColor(calibratedRed: 0.90, green: 0.95, blue: 1.0, alpha: 1)])!
gradient.draw(in: tileRect, angle: -90)
let glyphSize = tile * 0.70
let gRect = CGRect(x: (size - glyphSize) / 2, y: (size - glyphSize) / 2 + 10, width: glyphSize, height: glyphSize)
glyph.draw(in: gRect, from: .zero, operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: outPath))
