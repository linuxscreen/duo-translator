//
import { describe, it, expect } from 'vitest';
import {browser} from "wxt/browser";

function isUrl (url: string) {
    const domainRegex = /^(?!-)(?:[a-zA-Z\d-]{0,62}[a-zA-Z\d]\.){1,126}(?!d{1,3}\.)([a-zA-Z\d]{1,63})(?<!-)$/;
    let reg = new RegExp(domainRegex);
    return reg.test(url)
}

describe('test isUrl function', () => {
    it('google', () => {
        browser.runtime.sendMessage({action: "getAllRule"}).then((res) => {
            console.log(res);
        });
        expect(isUrl("www.google.com")).toEqual(true);
    });
    it('subdomain.example.com', () => {
        expect(isUrl("xx.xx.dev1..")).toEqual(true);
    });
    it('subdomain.example.com', () => {
        expect(isUrl("w.example.com")).toEqual(true);
    });
});