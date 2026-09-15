import AppKit

/// 从 macOS 文件图标入口读取结果；验证实际解析出的品牌标记，避免仅检查包内 PNG 而漏掉模板覆盖。
func verifyIcon(at path: String, outputDirectory: URL) throws -> Bool {
    let absolutePath = URL(fileURLWithPath: path).standardizedFileURL.path
    let image = NSWorkspace.shared.icon(forFile: absolutePath)
    var valid = true
    for size in [128, 256] {
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        image.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .copy, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        var visible = 0
        var green = 0
        var dark = 0
        for y in 0..<size {
            for x in 0..<size {
                let color = bitmap.colorAt(x: x, y: y)!.usingColorSpace(.deviceRGB)!
                if color.alphaComponent > 0.1 { visible += 1 }
                if color.alphaComponent <= 0.5 { continue }
                if color.greenComponent - color.redComponent > 0.12 && color.greenComponent - color.blueComponent > 0.025 { green += 1 }
                if max(color.redComponent, color.greenComponent, color.blueComponent) < 0.35 { dark += 1 }
            }
        }
        let pixels = Double(size * size)
        // 当前品牌图标同时含绿色增强标记和深色代码符号；模板卷轴两者均缺失。
        // 仅设宽松占比，容许系统圆角、缩放和桌面快捷方式角标改变边缘像素。
        let passed = Double(visible) / pixels > 0.35 && Double(green) / pixels > 0.005 && Double(dark) / pixels > 0.025
        valid = valid && passed
        let output = outputDirectory.appendingPathComponent("icon-\(size).png")
        try bitmap.representation(using: .png, properties: [:])!.write(to: output)
        print("\(passed ? "PASS" : "FAIL") \(size)px: visible=\(Double(visible) / pixels), green=\(Double(green) / pixels), dark=\(Double(dark) / pixels); \(output.path)")
    }
    return valid
}

let project = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let targets = CommandLine.arguments.count > 1 ? Array(CommandLine.arguments.dropFirst()) : [project.appendingPathComponent("CodeX 注入版.app").path]
let output = FileManager.default.temporaryDirectory.appendingPathComponent("codex-launcher-icon-\(UUID().uuidString)", isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
var passed = true
for (index, target) in targets.enumerated() {
    guard FileManager.default.fileExists(atPath: target) else {
        print("FAIL 应用路径不存在：\(target)")
        passed = false
        continue
    }
    print("系统图标：\(target)")
    let directory = output.appendingPathComponent(String(index), isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    passed = try verifyIcon(at: target, outputDirectory: directory) && passed
}
exit(passed ? 0 : 1)
