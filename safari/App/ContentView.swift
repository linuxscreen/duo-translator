//
//  ContentView.swift
//  DuoTranslator
//
//  Single status window: icon, name, enabled/disabled, one primary button,
//  three setup steps, footer links. Deliberately nothing else — every
//  feature lives in the extension's own popup / options page.
//

import AppKit
import SwiftUI

/// Public links. Keep in sync with VITE_WEBSITE / VITE_GITHUB_URL in .env.
private enum Links {
    static let website = URL(string: "https://duotranslator.com")!
    static let privacy = URL(string: "https://duotranslator.com/privacy")!
    static let github = URL(string: "https://github.com/linuxscreen/duo-translator")!
}

struct ContentView: View {
    @Environment(ExtensionState.self) private var state

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.top, 36)
                .padding(.bottom, 24)

            statusBadge
                .padding(.bottom, 16)

            Button {
                state.openSafariSettings()
            } label: {
                Text("Open Safari Extension Settings…")
                    .frame(minWidth: 220)
            }
            .controlSize(.large)
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
            .padding(.bottom, 28)

            Divider()
                .padding(.horizontal, 32)

            steps
                .padding(.vertical, 24)
                .padding(.horizontal, 36)

            Divider()
                .padding(.horizontal, 32)

            footer
                .padding(.vertical, 16)
        }
        .frame(width: 440)
        .background(.background)
        .onAppear(perform: state.refresh)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            // The user usually comes back from Safari's settings window.
            state.refresh()
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 96, height: 96)
            Text("Duo Translator for Safari")
                .font(.title.weight(.semibold))
            Text("Bilingual web page translation for Safari.")
                .font(.callout)
                .foregroundStyle(.secondary)
            Text("Version \(ExtensionState.version)")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }

    private var statusBadge: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(statusColor)
                .frame(width: 9, height: 9)
            Text(statusText)
                .font(.callout.weight(.medium))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .background(statusColor.opacity(0.12), in: Capsule())
        .help(statusHelp)
    }

    private var statusColor: Color {
        switch state.status {
        case .enabled: .green
        case .disabled: .orange
        case .unknown, .failed: .secondary
        }
    }

    private var statusText: LocalizedStringKey {
        switch state.status {
        case .enabled: "Enabled in Safari"
        case .disabled: "Not enabled in Safari"
        case .unknown: "Checking Safari…"
        case .failed: "Could not read the extension state"
        }
    }

    private var statusHelp: String {
        if case .failed(let message) = state.status { return message }
        return ""
    }

    private var steps: some View {
        VStack(alignment: .leading, spacing: 12) {
            Step(number: 1, text: "Turn on Duo Translator for Safari under Safari › Settings › Extensions.")
            Step(number: 2, text: "Allow it on websites: click its toolbar icon in Safari and choose “Always Allow on Every Website”.")
            Step(number: 3, text: "Translate any page from the toolbar icon, the right-click menu, or ⌥S.")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var footer: some View {
        HStack(spacing: 18) {
            FooterLink(title: "Website", url: Links.website)
            FooterLink(title: "Privacy Policy", url: Links.privacy)
            FooterLink(title: "GitHub", url: Links.github)
        }
        .font(.caption)
    }
}

private struct Step: View {
    let number: Int
    let text: LocalizedStringKey

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(number)")
                .font(.caption.weight(.semibold))
                .frame(width: 20, height: 20)
                .background(Color.accentColor.opacity(0.15), in: Circle())
            Text(text)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct FooterLink: View {
    @Environment(ExtensionState.self) private var state
    let title: LocalizedStringKey
    let url: URL

    var body: some View {
        Button(title) { state.open(url) }
            .buttonStyle(.link)
            .foregroundStyle(.secondary)
    }
}

#Preview {
    ContentView()
        .environment(ExtensionState())
}
