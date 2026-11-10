// @vitest-environment jsdom
//
// Document-shape helpers in utils/dom.ts that keep the content script alive in
// documents it used to crash in: SVG / raw XML (module evaluation — React DOM
// reads `.style` off createElement("div")) and HTML-namespace documents with no
// <body> (the first marking scan was handed `document.body === null`). The
// crashes themselves need a real injected bundle — see
// e2e/specs/translate.no-body.spec.ts.
import { describe, it, expect, afterEach } from "vitest";
import { bodyOrRoot, documentBody, isHtmlDocument } from "@/utils/dom";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

describe("isHtmlDocument", () => {
    it("accepts an HTML document", () => {
        expect(isHtmlDocument(document)).toBe(true);
    });

    it("accepts an XHTML document, which still creates HTML elements", () => {
        const doc = document.implementation.createDocument(XHTML_NS, "html", null);
        expect(doc.contentType).toBe("application/xhtml+xml");
        expect(isHtmlDocument(doc)).toBe(true);
        // ...and has no body: the shape that has to be handled downstream.
        expect(doc.body).toBeNull();
    });

    it("rejects an SVG document — createElement yields elements without .style", () => {
        const doc = document.implementation.createDocument(SVG_NS, "svg", null);
        expect(isHtmlDocument(doc)).toBe(false);
        expect((doc.createElement("div") as HTMLElement).style).toBeUndefined();
    });

    it("rejects a generic XML document", () => {
        const doc = document.implementation.createDocument(null, "item", null);
        expect(isHtmlDocument(doc)).toBe(false);
    });

    it("judges by what createElement produces, not by contentType", () => {
        // A text/plain page is an HTML document whose contentType is not
        // text/html; a contentType test would stop translating raw files.
        const doc = document.implementation.createHTMLDocument("");
        Object.defineProperty(doc, "contentType", { value: "text/plain" });
        expect(isHtmlDocument(doc)).toBe(true);
    });
});

describe("documentBody / bodyOrRoot", () => {
    let detached: HTMLElement | null = null;

    afterEach(() => {
        if (detached) document.documentElement.appendChild(detached);
        detached = null;
    });

    it("return the body when there is one", () => {
        expect(documentBody()).toBe(document.body);
        expect(bodyOrRoot()).toBe(document.body);
    });

    it("report null / fall back to the root when the body is gone", () => {
        detached = document.body;
        detached.remove();
        expect(document.body).toBeNull();
        expect(documentBody()).toBeNull();
        expect(bodyOrRoot()).toBe(document.documentElement);
    });
});
