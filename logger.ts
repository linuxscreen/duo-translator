import log from 'loglevel';

// 设置日志级别（trace, debug, info, warn, error, silent）
log.setLevel('info');

// 自定义 appender，将日志存储到 Chrome 存储中
const originalFactory = log.methodFactory;

log.methodFactory = function (methodName, logLevel, loggerName) {
    const rawMethod = originalFactory(methodName, logLevel, loggerName);

    return function (...args) {
        const logMessage = {
            level: methodName.toUpperCase(),
            data: args,
            timestamp: new Date().toISOString(),
        };

        // 在开发环境中打印日志到控制台
        // if (!browser.runtime.id) {
            rawMethod(...args);
        // }

        // 存储日志到 Chrome 存储
        // browser.storage.local.get({ logs: [] }).then( (result) => {
        //     const logs = result.logs;
        //     logs.push(logMessage);
        //     browser.storage.local.set({ logs });
        // });
    };
};

log.setLevel(log.getLevel()); // 重新设置方法工厂

// 导出一个下载日志文件的方法
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
