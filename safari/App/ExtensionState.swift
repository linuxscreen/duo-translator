//
//  ExtensionState.swift
//  DuoTranslator
//
//  Thin wrapper over SafariServices: is the extension enabled, and open
//  Safari's extension settings. The extension's bundle identifier is derived
//  from the app's so the two can never drift apart.
//

import AppKit
import Observation
import SafariServices

@Observable
@MainActor
final class ExtensionState {
    enum Status: Equatable {
        case unknown
        case enabled
        case disabled
        case failed(String)
    }

    private(set) var status: Status = .unknown

    /// Must match PRODUCT_BUNDLE_IDENTIFIER of the "DuoTranslator Extension" target.
    nonisolated static let extensionIdentifier: String = {
        (Bundle.main.bundleIdentifier ?? "com.duotranslator.safari") + ".extension"
    }()

    static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }

    func refresh() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: Self.extensionIdentifier) { state, error in
            let next: Status
            if let state {
                next = state.isEnabled ? .enabled : .disabled
            } else {
                next = .failed(error?.localizedDescription ?? "Unknown error")
            }
            Task { @MainActor in
                self.status = next
            }
        }
    }

    func openSafariSettings() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: Self.extensionIdentifier) { error in
            guard let error else { return }
            Task { @MainActor in
                self.status = .failed(error.localizedDescription)
            }
        }
    }

    nonisolated func open(_ url: URL) {
        NSWorkspace.shared.open(url)
    }
}
