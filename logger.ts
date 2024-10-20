import log from 'loglevel';

// set log level（trace, debug, info, warn, error, silent）
log.setLevel('info');

// Customize the appender to store logs in Chrome storage
const originalFactory = log.methodFactory;

log.methodFactory = function (methodName, logLevel, loggerName) {
    const rawMethod = originalFactory(methodName, logLevel, loggerName);

    return function (...args) {
        const logMessage = {
            level: methodName.toUpperCase(),
            data: args,
            timestamp: new Date().toISOString(),
        };

        // print logs to the console in the development environment
        // if (!browser.runtime.id) {
            rawMethod(...args);
        // }

        // save logs to chrome storage
        // browser.storage.local.get({ logs: [] }).then( (result) => {
        //     const logs = result.logs;
        //     logs.push(logMessage);
        //     browser.storage.local.set({ logs });
        // });
    };
};

log.setLevel(log.getLevel()); // reset the method factory

// export a method for downloading log files
// export function downloadLogs() {
//     chrome.storage.local.get({ logs: [] }, (result) => {
//         const logs = result.logs;
//         const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
//         const url = URL.createObjectURL(blob);
//
//         chrome.downloads.download({
//             url: url,
//             filename: 'logs.json',
//             conflictAction: 'overwrite',
//         }, () => {
//             URL.revokeObjectURL(url);
//         });
//     });
// }

export default log;
