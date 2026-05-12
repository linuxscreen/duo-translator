import * as OpenCC from 'opencc-js';

export function isTraditionalChinese(input: string) {
    const converterTw = OpenCC.Converter({ from:'t', to: 'cn' });
    // const converterHk = OpenCC.Converter({ from:'cn', to: 'hk' });
    let convertedTw = converterTw(input)
    // let convertedHk = converterHk(input)
    // console.log(convertedTw)
    // console.log(converted)
    return convertedTw != input; // If the converted characters are different from the original characters, the characters are Simplified Chinese

}