import AppKit

/// 为 CodeX 注入版生成原生多尺寸图标，用代码符号和增强标记表达整个工具的用途。
/// 先绘制独立像素画布，再交给 iconutil 封装；不读取或修改 Codex 的应用图标。
func writeIcon(size: Int, to url: URL) throws {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0), let context = NSGraphicsContext(bitmapImageRep: bitmap) else { throw NSError(domain: "CodeXInjectedIcon", code: 1) }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    let transform = AffineTransform(scale: CGFloat(size) / 1024)
    (transform as NSAffineTransform).concat()

    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.16)
    shadow.shadowBlurRadius = 22
    shadow.shadowOffset = NSSize(width: 0, height: -12)
    shadow.set()
    let tile = NSBezierPath(roundedRect: NSRect(x: 64, y: 64, width: 896, height: 896), xRadius: 204, yRadius: 204)
    let upper = NSColor(calibratedWhite: 0.995, alpha: 1)
    let lower = NSColor(calibratedWhite: 0.91, alpha: 1)
    NSGradient(starting: lower, ending: upper)!.draw(in: tile, angle: 90)
    NSGraphicsContext.restoreGraphicsState()
    NSColor(calibratedWhite: 0.77, alpha: 0.55).setStroke()
    tile.lineWidth = 3
    tile.stroke()

    // 三段独立笔画让 16px 小尺寸也保留清楚的代码轮廓，不依赖字体是否安装。
    let code = NSBezierPath()
    code.move(to: NSPoint(x: 393, y: 678))
    code.line(to: NSPoint(x: 244, y: 512))
    code.line(to: NSPoint(x: 393, y: 346))
    code.move(to: NSPoint(x: 631, y: 678))
    code.line(to: NSPoint(x: 780, y: 512))
    code.line(to: NSPoint(x: 631, y: 346))
    code.lineWidth = 62
    code.lineCapStyle = .round
    code.lineJoinStyle = .round
    NSColor(calibratedRed: 0.14, green: 0.16, blue: 0.18, alpha: 1).setStroke()
    code.stroke()
    let slash = NSBezierPath()
    slash.move(to: NSPoint(x: 556, y: 698))
    slash.line(to: NSPoint(x: 468, y: 326))
    slash.lineWidth = 46
    slash.lineCapStyle = .round
    slash.stroke()

    // 增强标记与主符号保持间隔，避免继续把入口理解成单一检测功能。
    NSColor(calibratedRed: 0.16, green: 0.43, blue: 0.35, alpha: 1).setFill()
    NSBezierPath(ovalIn: NSRect(x: 712, y: 718, width: 152, height: 152)).fill()
    let plus = NSBezierPath()
    plus.move(to: NSPoint(x: 756, y: 794))
    plus.line(to: NSPoint(x: 820, y: 794))
    plus.move(to: NSPoint(x: 788, y: 762))
    plus.line(to: NSPoint(x: 788, y: 826))
    plus.lineWidth = 16
    plus.lineCapStyle = .round
    NSColor.white.setStroke()
    plus.stroke()
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else { throw NSError(domain: "CodeXInjectedIcon", code: 2) }
    try png.write(to: url)
}

let assets = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let iconset = assets.appendingPathComponent("CodeXInjected.iconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
    try writeIcon(size: base, to: iconset.appendingPathComponent("icon_\(base)x\(base).png"))
    try writeIcon(size: base * 2, to: iconset.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
try writeIcon(size: 1024, to: assets.appendingPathComponent("icon.png"))
