//
//  SafariWebExtensionHandler.swift
//  DuoTranslator Extension
//
//  Required principal class for a Safari web extension. The extension never
//  calls browser.runtime.sendNativeMessage, so this only acknowledges
//  requests; all real work happens in the bundled web extension (Resources/).
//

import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: [:] as [String: Any]]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
