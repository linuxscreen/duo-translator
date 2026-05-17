import { APP_NAME_WITH_SUFFIX } from "@/main/constants";

/**
 * get domain with port from url
 * @param url
 */
export function getDomainWithPortFromUrl(url: string) {
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.port !== "") {
            return parsedUrl.hostname + ':' + parsedUrl.port; // For non-standard ports, we need to add a port number
        }
        return parsedUrl.hostname; // only get the domain name
    } catch (error) {
        console.error(APP_NAME_WITH_SUFFIX, 'Invalid URL:', error);
        return "";
    }
}