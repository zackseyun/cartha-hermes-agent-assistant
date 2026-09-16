import AppKit

// A real app identity lets macOS mediate Documents access. Never reset TCC,
// relocate protected source, or silently run under another app's permissions.
final class Launcher: NSObject, NSApplicationDelegate {
    var process: Process?
    var log: FileHandle?

    func fail(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Hermes couldn’t start"
        alert.informativeText = message + "\n\nYour conversations and account settings have not been changed."
        alert.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
        NSApp.terminate(nil)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let path = Bundle.main.object(forInfoDictionaryKey: "HermesStartupScript") as? String else {
            fail("The launcher is missing its startup path. Reinstall the launcher.")
            return
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        let logs = home.appendingPathComponent(".hermes/profiles/founder/logs")
        do {
            try FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
            let file = logs.appendingPathComponent("desktop-launcher.log")
            if !FileManager.default.fileExists(atPath: file.path) {
                FileManager.default.createFile(atPath: file.path, contents: nil,
                                               attributes: [.posixPermissions: 0o600])
            }
            log = try FileHandle(forWritingTo: file)
            try log?.seekToEnd()
            try log?.write(contentsOf: Data("\nNative Hermes launcher: \(Date())\n".utf8))
            // Read normally under this app's identity; macOS owns the consent UI.
            _ = try Data(contentsOf: URL(fileURLWithPath: path))
            let child = Process()
            child.executableURL = URL(fileURLWithPath: "/bin/sh")
            child.arguments = [path]
            child.currentDirectoryURL = home
            child.standardOutput = log
            child.standardError = log
            child.terminationHandler = { task in
                DispatchQueue.main.async {
                    if task.terminationStatus != 0 {
                        self.fail("Startup stopped with exit code \(task.terminationStatus). See \(file.path) for details.")
                    } else {
                        NSApp.terminate(nil)
                    }
                }
            }
            process = child
            try child.run()
        } catch {
            try? log?.write(contentsOf: Data("Startup error: \(error.localizedDescription)\n".utf8))
            fail("macOS could not read or start the Hermes startup code in Documents. If access was denied, review System Settings → Privacy & Security → Files & Folders → Hermes App.\n\n\(error.localizedDescription)")
        }
    }
}
let app = NSApplication.shared
let delegate = Launcher()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
