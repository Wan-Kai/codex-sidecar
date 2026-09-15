import AppKit
import Darwin

enum ShortcutError: Error, CustomStringConvertible {
    case invalid(String)
    var description: String { switch self { case let .invalid(message): return message } }
}

/// 只允许替换本项目的旧软链接或原生替身；拒绝同名普通文件、目录及其他应用的快捷入口。
func checkOwnership(destination: URL, source: URL) throws {
    let manager = FileManager.default
    let attributes: [FileAttributeKey: Any]
    do { attributes = try manager.attributesOfItem(atPath: destination.path) }
    catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError { return }
    let target: URL
    if attributes[.type] as? FileAttributeType == .typeSymbolicLink {
        target = destination.resolvingSymlinksInPath()
    } else if try destination.resourceValues(forKeys: [.isAliasFileKey]).isAliasFile == true {
        target = try URL(resolvingAliasFileAt: destination, options: [.withoutUI, .withoutMounting])
    } else {
        throw ShortcutError.invalid("同名桌面入口不属于本项目，未覆盖：\(destination.path)")
    }
    guard target.resolvingSymlinksInPath().standardizedFileURL.path == source.path else {
        throw ShortcutError.invalid("桌面入口指向其他位置，未覆盖：\(destination.path)")
    }
}

/// 先创建并验证原生替身及独立图标，再原子替换入口，避免构建失败留下半成品或断开的快捷方式。
func buildShortcut(source: URL, destination: URL, iconURL: URL) throws {
    guard Bundle(url: source)?.bundleIdentifier == "local.codex.iq-launcher" else {
        throw ShortcutError.invalid("源应用不属于本项目，未创建入口")
    }
    guard let icon = NSImage(contentsOf: iconURL), icon.isValid else {
        throw ShortcutError.invalid("入口图标不可读取")
    }
    try checkOwnership(destination: destination, source: source)
    let staged = destination.deletingLastPathComponent().appendingPathComponent(".codex-shortcut-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: staged) }
    let bookmark = try source.bookmarkData(options: [.suitableForBookmarkFile], includingResourceValuesForKeys: nil, relativeTo: nil)
    try URL.writeBookmarkData(bookmark, to: staged)
    // Finder 的软链接和默认替身图标均未继承应用图标；显式资源只写入替身，不修改已签名应用。
    guard NSWorkspace.shared.setIcon(icon, forFile: staged.path, options: []) else {
        throw ShortcutError.invalid("写入替身独立图标失败")
    }
    let resolved = try URL(resolvingAliasFileAt: staged, options: [.withoutUI, .withoutMounting])
    guard resolved.resolvingSymlinksInPath().standardizedFileURL.path == source.path else {
        throw ShortcutError.invalid("替身未指向正确应用")
    }
    // 临时文件与入口位于同一文件系统；rename 替换链接本身，不跟随旧软链接修改应用包。
    try checkOwnership(destination: destination, source: source)
    let result = staged.path.withCString { from in destination.path.withCString { to in Darwin.rename(from, to) } }
    guard result == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    // 最终路径再次设置图标会通知 Finder 刷新已展示的旧入口，无需重启 Finder 或清除全局缓存。
    guard NSWorkspace.shared.setIcon(icon, forFile: destination.path, options: []) else {
        throw ShortcutError.invalid("入口已创建，但最终图标刷新失败")
    }
    print(destination.path)
}

do {
    guard CommandLine.arguments.count == 4 else { throw ShortcutError.invalid("用法：swift build-shortcut.swift 源应用 桌面入口 ICNS图标") }
    let source = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath().standardizedFileURL
    let destination = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
    let icon = URL(fileURLWithPath: CommandLine.arguments[3]).standardizedFileURL
    guard source.path != destination.path else { throw ShortcutError.invalid("入口不能覆盖应用本体") }
    try buildShortcut(source: source, destination: destination, iconURL: icon)
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
