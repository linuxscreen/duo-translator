//
//  DuoTranslatorApp.swift
//  DuoTranslator
//
//  The macOS container app for the Safari web extension. It exists because
//  Safari only loads web extensions that ship inside a signed app; the app
//  itself does one thing — tell the user whether the extension is enabled
//  and take them to Safari's extension settings.
//

import AppKit
import SwiftUI

@main
struct DuoTranslatorApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var extensionState = ExtensionState()

    var body: some Scene {
        Window("Duo Translator for Safari", id: "main") {
            ContentView()
                .environment(extensionState)
        }
        .windowResizability(.contentSize)
        .windowStyle(.hiddenTitleBar)
        .defaultPosition(.center)
        .commands {
            // The template "New Window" item makes no sense for a single-window
            // status app.
            CommandGroup(replacing: .newItem) {}
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // Nothing runs in the background — the extension lives in Safari.
        true
    }
}
