// Generates AppIcon.iconset PNGs with Core Graphics.
// Usage: swift scripts/generate-icon.swift <output-iconset-dir>
// Motif: dark cockpit plate with three agent-colored control sliders
// (Claude orange / Codex green / Cursor violet).

import AppKit

func color(_ hex: UInt32, _ alpha: CGFloat = 1.0) -> NSColor {
    NSColor(
        calibratedRed: CGFloat((hex >> 16) & 0xFF) / 255.0,
        green: CGFloat((hex >> 8) & 0xFF) / 255.0,
        blue: CGFloat(hex & 0xFF) / 255.0,
        alpha: alpha
    )
}

func drawIcon(pixels: Int) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    )!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    defer { NSGraphicsContext.restoreGraphicsState() }

    let s = CGFloat(pixels) / 1024.0

    // Apple-style plate: 824pt square, 185pt corner radius, centered
    let plate = NSRect(x: 100 * s, y: 100 * s, width: 824 * s, height: 824 * s)
    let platePath = NSBezierPath(roundedRect: plate, xRadius: 185 * s, yRadius: 185 * s)
    NSGradient(starting: color(0x1C232C), ending: color(0x0B0F14))!.draw(in: platePath, angle: -90)

    // subtle top edge highlight
    platePath.lineWidth = 6 * s
    color(0xFFFFFF, 0.06).setStroke()
    platePath.stroke()

    // three sliders
    let sliders: [(UInt32, CGFloat, CGFloat)] = [
        (0xD97757, 660, 0.72), // claude
        (0x10A37F, 492, 0.38), // codex
        (0xA78BFA, 324, 0.58), // cursor
    ]
    let trackX: CGFloat = 226
    let trackW: CGFloat = 572
    let trackH: CGFloat = 44

    for (hex, y, pos) in sliders {
        let track = NSRect(x: trackX * s, y: y * s, width: trackW * s, height: trackH * s)
        let trackPath = NSBezierPath(roundedRect: track, xRadius: trackH / 2 * s, yRadius: trackH / 2 * s)
        color(0xFFFFFF, 0.10).setFill()
        trackPath.fill()

        // filled segment
        let knobX = trackX + trackW * pos
        let fill = NSRect(x: trackX * s, y: y * s, width: (knobX - trackX) * s, height: trackH * s)
        let fillPath = NSBezierPath(roundedRect: fill, xRadius: trackH / 2 * s, yRadius: trackH / 2 * s)
        color(hex, 0.85).setFill()
        fillPath.fill()

        // knob
        let r: CGFloat = 62
        let knob = NSRect(x: (knobX - r) * s, y: (y + trackH / 2 - r) * s, width: r * 2 * s, height: r * 2 * s)
        let knobPath = NSBezierPath(ovalIn: knob)
        color(0xF2F5F8).setFill()
        knobPath.fill()
        let inner = knob.insetBy(dx: 34 * s, dy: 34 * s)
        color(hex).setFill()
        NSBezierPath(ovalIn: inner).fill()
    }

    return rep
}

let args = CommandLine.arguments
guard args.count == 2 else {
    FileHandle.standardError.write("usage: swift generate-icon.swift <output-iconset-dir>\n".data(using: .utf8)!)
    exit(1)
}
let outDir = args[1]
try! FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let sizes: [(String, Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]
for (name, px) in sizes {
    let rep = drawIcon(pixels: px)
    let data = rep.representation(using: .png, properties: [:])!
    try! data.write(to: URL(fileURLWithPath: "\(outDir)/\(name).png"))
}
print("iconset written to \(outDir)")
